// Crop-box geometry. Rects are in source pixels of the (EXIF-oriented) image
// unless noted; "fractions" are the same rect divided by the image size.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** "16:9", "16x9", "4/5" or "1.5" → width / height, or null when invalid. */
export function parseRatio(s: string): number | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(?:[:x×/]\s*(\d+(?:\.\d+)?))?$/i);
  if (!m) return null;
  const r = m[2] === undefined ? Number(m[1]) : Number(m[1]) / Number(m[2]);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Same size, moved back inside the image. */
export function clampMove(r: Rect, W: number, H: number): Rect {
  const w = Math.min(r.w, W);
  const h = Math.min(r.h, H);
  return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h };
}

/**
 * Drags `handle` of `s` by (dx, dy). The opposite edge/corner stays put; with a
 * locked aspect, edge handles grow symmetrically around the centre line.
 */
export function resizeRect(s: Rect, handle: Handle, dx: number, dy: number, aspect: number | null, W: number, H: number, min = 1): Rect {
  const n = handle.includes("n");
  const so = handle.includes("s");
  const we = handle.includes("w");
  const e = handle.includes("e");
  if (!aspect) {
    let l = s.x;
    let t = s.y;
    let r = s.x + s.w;
    let b = s.y + s.h;
    if (we) l = clamp(l + dx, 0, r - min);
    if (e) r = clamp(r + dx, l + min, W);
    if (n) t = clamp(t + dy, 0, b - min);
    if (so) b = clamp(b + dy, t + min, H);
    return { x: l, y: t, w: r - l, h: b - t };
  }
  const ax = we ? s.x + s.w : e ? s.x : s.x + s.w / 2;
  const ay = n ? s.y + s.h : so ? s.y : s.y + s.h / 2;
  const maxW = we ? ax : e ? W - ax : 2 * Math.min(ax, W - ax);
  const maxH = n ? ay : so ? H - ay : 2 * Math.min(ay, H - ay);
  const pw = we || e ? s.w + (we ? -dx : dx) : 0;
  const ph = n || so ? s.h + (n ? -dy : dy) : 0;
  // Corners follow whichever axis moved further; edges have one proposal only.
  const w = clamp(Math.max(pw, ph * aspect), Math.max(min, min * aspect), Math.min(maxW, maxH * aspect));
  const h = w / aspect;
  return { x: we ? ax - w : e ? ax : ax - w / 2, y: n ? ay - h : so ? ay : ay - h / 2, w, h };
}

/** Largest rect of `aspect` centred inside `r`. */
export function fitAspect(r: Rect, aspect: number): Rect {
  const w = Math.min(r.w, r.h * aspect);
  const h = w / aspect;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** Largest centred crop of `aspect` (the whole image when null). */
export function centerCrop(W: number, H: number, aspect: number | null): Rect {
  return aspect ? fitAspect({ x: 0, y: 0, w: W, h: H }, aspect) : { x: 0, y: 0, w: W, h: H };
}

export const toFrac = (r: Rect, W: number, H: number): Rect => ({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H });
export const fromFrac = (f: Rect, W: number, H: number): Rect => ({ x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H });

/** Whole pixels inside the image, at least 1×1. */
export function roundRect(r: Rect, W: number, H: number): Rect {
  const x = clamp(Math.round(r.x), 0, W - 1);
  const y = clamp(Math.round(r.y), 0, H - 1);
  return { x, y, w: clamp(Math.round(r.w), 1, W - x), h: clamp(Math.round(r.h), 1, H - y) };
}

export type BatchMode = "same" | "center";

/**
 * The crop of one image in a batch. "same": the shared fractional rect (re-fitted
 * to the aspect, since a proportional rect on a differently shaped image loses it).
 * "center": the image's own adjusted rect, or the largest centred crop.
 */
export function cropFor(mode: BatchMode, shared: Rect, own: Rect | undefined, aspect: number | null, W: number, H: number): Rect {
  if (mode === "center") return own ? fromFrac(own, W, H) : centerCrop(W, H, aspect);
  const r = fromFrac(shared, W, H);
  return aspect ? fitAspect(r, aspect) : r;
}

/**
 * Numeric field edit: the typed value wins; the size shrinks (keeping the
 * aspect) so the box stays inside the image.
 */
export function editField(r: Rect, key: keyof Rect, value: number, aspect: number | null, W: number, H: number): Rect {
  const next = { ...r, [key]: Math.max(key === "x" || key === "y" ? 0 : 1, value) };
  next.x = Math.min(next.x, W - 1);
  next.y = Math.min(next.y, H - 1);
  if (aspect && key === "w") next.h = next.w / aspect;
  if (aspect && key === "h") next.w = next.h * aspect;
  if (aspect) {
    const k = Math.min(1, (W - next.x) / next.w, (H - next.y) / next.h);
    next.w *= k;
    next.h *= k;
  } else {
    next.w = Math.min(next.w, W - next.x);
    next.h = Math.min(next.h, H - next.y);
  }
  return next;
}
