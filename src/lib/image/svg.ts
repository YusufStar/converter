import type { Size } from "./resize";

// CSS px per unit (96 dpi).
const UNIT: Record<string, number> = { "": 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, em: 16, rem: 16, ex: 8 };

/** "12.5mm" → px; null for %, auto or garbage. */
export function parseLength(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!m) return null;
  const factor = UNIT[m[2].toLowerCase()];
  const n = Number(m[1]) * (factor ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseViewBox(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) return null;
  return parts as [number, number, number, number];
}

function parseSvg(text: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.nodeName.toLowerCase() !== "svg") throw new Error("Invalid SVG file");
  return root as unknown as SVGSVGElement;
}

/**
 * The size an SVG renders at by default: width/height attributes, falling
 * back to the viewBox, falling back to the browser default 300×150.
 */
export function svgIntrinsicSize(text: string): Size {
  const svg = parseSvg(text);
  const vb = parseViewBox(svg.getAttribute("viewBox"));
  let w = parseLength(svg.getAttribute("width"));
  let h = parseLength(svg.getAttribute("height"));
  if (vb) {
    const ratio = vb[2] / vb[3];
    if (w && !h) h = w / ratio;
    else if (h && !w) w = h * ratio;
    else if (!w && !h) {
      w = vb[2];
      h = vb[3];
    }
  }
  return { width: w ?? 300, height: h ?? 150 };
}

/**
 * Re-writes the root width/height so the browser rasterises the vector
 * directly at the target size (no bitmap upscaling = no blur). A viewBox is
 * added when missing so the drawing scales with the new size.
 */
export function sizeSvg(text: string, width: number, height: number): string {
  const svg = parseSvg(text);
  const original = svgIntrinsicSize(text);
  if (!parseViewBox(svg.getAttribute("viewBox"))) svg.setAttribute("viewBox", `0 0 ${original.width} ${original.height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  // Stretch only when the caller asked for a different aspect ratio.
  const stretch = Math.abs(width / height - original.width / original.height) > 0.01;
  if (stretch) svg.setAttribute("preserveAspectRatio", "none");
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(svg);
}
