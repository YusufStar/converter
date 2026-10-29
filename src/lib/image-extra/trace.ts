// Raster → SVG with imagetracerjs: presets, option mapping, background removal
// and a compact SVG writer (one <path> per colour layer). Pure: runs in the
// trace worker and in unit tests.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Segment {
  type: "L" | "Q";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3?: number;
  y3?: number;
}

export interface TracePath {
  segments: Segment[];
  holechildren: number[];
  isholepath: boolean;
}

export interface TraceData {
  layers: TracePath[][];
  palette: Rgba[];
  width: number;
  height: number;
}

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Tracer {
  imagedataToTracedata(img: Pixels, options: Record<string, unknown>): TraceData;
}

export type TracePreset = "detailed" | "posterized" | "smooth" | "lineart" | "pixel";

export interface TraceSettings {
  preset: TracePreset;
  /** Palette size, 2–64. */
  colors: number;
  /** Selective blur radius before tracing, 0–5. */
  blur: number;
  /** Drop paths with fewer edge points than this (specks). */
  omit: number;
  /** Skip the colour layer closest to the most common edge colour. */
  removeBg: boolean;
  /** Longest side the image is traced at, px. */
  size: number;
}

export const PRESETS: Record<TracePreset, Omit<TraceSettings, "preset" | "size">> = {
  detailed: { colors: 32, blur: 0, omit: 0, removeBg: false },
  posterized: { colors: 6, blur: 2, omit: 8, removeBg: false },
  smooth: { colors: 16, blur: 3, omit: 8, removeBg: false },
  lineart: { colors: 2, blur: 0, omit: 8, removeBg: true },
  pixel: { colors: 16, blur: 0, omit: 0, removeBg: false },
};

/** imagetracer knobs that make each preset (ltres/qtres: line/curve error tolerance). */
const TRACER: Record<TracePreset, Record<string, unknown>> = {
  detailed: { ltres: 0.5, qtres: 0.5, rightangleenhance: true, colorsampling: 2, colorquantcycles: 3 },
  posterized: { ltres: 1, qtres: 1, rightangleenhance: true, colorsampling: 2, colorquantcycles: 3 },
  smooth: { ltres: 0.01, qtres: 1, rightangleenhance: false, linefilter: true, colorsampling: 2, colorquantcycles: 3 },
  // A fixed grey palette kept as is (one cycle): pure black / white for 2 colours.
  lineart: { ltres: 1, qtres: 1, rightangleenhance: true, colorsampling: 0, colorquantcycles: 1 },
  // Curves rejected (tiny qtres) → straight, right-angled pixel edges.
  pixel: { ltres: 1, qtres: 0.01, rightangleenhance: true, colorsampling: 2, colorquantcycles: 3 },
};

export function tracerOptions(s: TraceSettings): Record<string, unknown> {
  return {
    linefilter: false,
    ...TRACER[s.preset],
    numberofcolors: Math.round(Math.min(64, Math.max(2, s.colors))),
    blurradius: Math.round(Math.min(5, Math.max(0, s.blur))),
    blurdelta: 64,
    pathomit: Math.max(0, Math.round(s.omit)),
    mincolorratio: 0,
    layering: 0,
    strokewidth: 1,
    roundcoords: 1,
    scale: 1,
    viewbox: false,
    desc: false,
    lcpr: 0,
    qcpr: 0,
  };
}

// imagetracer keeps one JS array cell per pixel per colour: cap colours × pixels.
const CELL_BUDGET = 24e6;

/** Size the image is traced at: at most `size` on the long side and within the memory budget. */
export function traceSize(W: number, H: number, s: Pick<TraceSettings, "size" | "colors">): { width: number; height: number } {
  const k = Math.min(1, s.size / Math.max(W, H), Math.sqrt(CELL_BUDGET / (Math.max(2, s.colors) * W * H)));
  return { width: Math.max(1, Math.round(W * k)), height: Math.max(1, Math.round(H * k)) };
}

/** Most common colour along the border (4-bit buckets; transparent counts as one colour). */
export function edgeColor({ width: w, height: h, data }: Pixels): Rgba {
  const buckets = new Map<number, number[]>();
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const key = data[i + 3] < 128 ? -1 : ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) ?? [0, 0, 0, 0, 0];
    b[0]++;
    for (let c = 0; c < 4; c++) b[c + 1] += data[i + c];
    buckets.set(key, b);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    if (h > 1) add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    if (w > 1) add(w - 1, y);
  }
  const [n, r, g, b, a] = [...buckets.values()].reduce((best, x) => (x[0] > best[0] ? x : best));
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n) };
}

const dist = (p: Rgba, c: Rgba) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) + Math.abs(p.a - c.a);

/**
 * Starting palette for imagetracer's k-means: the most common colour, then
 * greedily the colour with the highest count × distance² to those already
 * picked. imagetracer's own grid sampling easily merges small, distinct areas.
 */
export function seedPalette({ data }: Pixels, n: number): Rgba[] {
  const hist = new Map<number, number[]>();
  const step = 4 * Math.max(1, Math.floor(data.length / 4 / 250_000));
  for (let i = 0; i < data.length; i += step) {
    const key = data[i + 3] < 128 ? -1 : ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const h = hist.get(key) ?? [0, 0, 0, 0, 0];
    h[0]++;
    for (let c = 0; c < 4; c++) h[c + 1] += data[i + c];
    hist.set(key, h);
  }
  const cols = [...hist.values()].map(([k, r, g, b, a]) => ({ k, r: r / k, g: g / k, b: b / k, a: a / k })).sort((x, y) => y.k - x.k);
  const picked = [cols[0]];
  const near = cols.map((c) => dist(c, cols[0]));
  while (picked.length < n) {
    let best = -1;
    let score = 0;
    cols.forEach((c, i) => {
      const s = c.k * near[i] * near[i];
      if (s > score) [best, score] = [i, s];
    });
    if (best < 0) break;
    picked.push(cols[best]);
    cols.forEach((c, i) => (near[i] = Math.min(near[i], dist(c, cols[best]))));
  }
  return picked.map(({ r, g, b, a }) => ({ r: Math.round(r), g: Math.round(g), b: Math.round(b), a: Math.round(a) }));
}

export function nearestColor(palette: Rgba[], c: Rgba): number {
  let best = 0;
  let bestD = Infinity;
  palette.forEach((p, i) => {
    const d = dist(p, c);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

export function hexColor({ r, g, b }: Rgba): string {
  const h = hex2(r) + hex2(g) + hex2(b);
  return h[0] === h[1] && h[2] === h[3] && h[4] === h[5] ? `#${h[0]}${h[2]}${h[4]}` : `#${h}`;
}

const num = (v: number) => String(+v.toFixed(1));
const pt = (x: number, y: number) => `${num(x)} ${num(y)}`;

/** One traced shape with its holes (drawn reversed, so the nonzero rule cuts them out). */
function pathData(layer: TracePath[], idx: number): string {
  const segs = layer[idx].segments;
  let d = `M${pt(segs[0].x1, segs[0].y1)}`;
  for (const s of segs) d += s.type + pt(s.x2, s.y2) + (s.x3 !== undefined ? ` ${pt(s.x3, s.y3!)}` : "");
  d += "Z";
  for (const h of layer[idx].holechildren) {
    const hs = layer[h].segments;
    const last = hs[hs.length - 1];
    d += `M${last.x3 !== undefined ? pt(last.x3, last.y3!) : pt(last.x2, last.y2)}`;
    for (let i = hs.length - 1; i >= 0; i--) {
      const s = hs[i];
      d += s.type + (s.x3 !== undefined ? `${pt(s.x2, s.y2)} ` : "") + pt(s.x1, s.y1);
    }
    d += "Z";
  }
  return d;
}

/**
 * Minified SVG: one <path> per colour layer, hex colours, no metadata. The
 * traced size is the viewBox; width/height give the original image size.
 */
export function buildSvg(td: TraceData, o: { width: number; height: number; skip?: Set<number>; linefilter?: boolean }): { svg: string; paths: number } {
  let body = "";
  let paths = 0;
  td.layers.forEach((layer, li) => {
    const c = td.palette[li];
    if (o.skip?.has(li) || !c || c.a === 0) return;
    let d = "";
    layer.forEach((p, pi) => {
      if (p.isholepath || !p.segments.length || (o.linefilter && p.segments.length < 3)) return;
      d += pathData(layer, pi);
      paths++;
    });
    if (!d) return;
    const col = hexColor(c);
    const op = c.a < 255 ? ` opacity="${+(c.a / 255).toFixed(3)}"` : "";
    // Same-colour stroke closes hairline gaps between neighbouring shapes.
    body += `<path fill="${col}" stroke="${col}"${op} d="${d}"/>`;
  });
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${td.width} ${td.height}">${body}</svg>`,
    paths,
  };
}

export interface TraceJob {
  image: Pixels;
  settings: TraceSettings;
  /** Original image size for the SVG width/height. */
  width: number;
  height: number;
}

export function traceImage(tracer: Tracer, job: TraceJob): { svg: string; paths: number } {
  // Read the edge colour first: the tracer may blur the pixels in place.
  const bg = job.settings.removeBg ? edgeColor(job.image) : null;
  const options = tracerOptions(job.settings);
  // Line art keeps imagetracer's fixed grey palette; the rest start from the image's own colours.
  if (options.colorsampling !== 0) options.pal = seedPalette(job.image, options.numberofcolors as number);
  const td = tracer.imagedataToTracedata(job.image, options);
  const skip = new Set<number>();
  if (bg) skip.add(nearestColor(td.palette, bg));
  return buildSvg(td, { width: job.width, height: job.height, skip, linefilter: options.linefilter === true });
}
