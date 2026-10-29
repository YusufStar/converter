// Text stamped onto pages: page numbers and watermarks. Positions are worked
// out in the page as the reader sees it (after /Rotate) and then mapped back
// to PDF user space, so rotated and cropped pages come out right.
import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import { loadPdf, savePdf } from "./edit";
import { pageSelection } from "./ranges";

type Bytes = Uint8Array | ArrayBuffer;

/** Visible page rectangle in user space. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const normRotation = (deg: number) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

/** Width/height as displayed (90°/270° swap the sides). */
export function visualSize(box: Box, rotation: number): { width: number; height: number } {
  const r = normRotation(rotation);
  return r === 90 || r === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

/** Maps a point of the displayed page (origin bottom-left) to user space. /Rotate turns pages clockwise. */
export function toUserSpace(vx: number, vy: number, box: Box, rotation: number): { x: number; y: number } {
  const { width: W, height: H } = box;
  const r = normRotation(rotation);
  const [x, y] = r === 90 ? [W - vy, vx] : r === 180 ? [W - vx, H - vy] : r === 270 ? [vy, H - vx] : [vx, vy];
  return { x: box.x + x, y: box.y + y };
}

export type Spot = "tl" | "tc" | "tr" | "bl" | "bc" | "br";

/** Baseline-left point of a text box `textW`×`textH` placed at `spot`, `margin` from the edges. */
export function spotPosition(spot: Spot, pageW: number, pageH: number, textW: number, textH: number, margin: number) {
  const col = spot[1];
  const x = col === "l" ? margin : col === "r" ? pageW - margin - textW : (pageW - textW) / 2;
  const y = spot[0] === "t" ? pageH - margin - textH : margin;
  return { x, y };
}

/** "Page {n} of {total}" → "Page 3 of 12". */
export const formatNumber = (template: string, n: number, total: number) =>
  template.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));

/**
 * Where to put the baseline-left corner of a text box w×h rotated `angle`°
 * counter-clockwise about that corner. "center" centres one copy on the page,
 * "tile" covers the page with a staggered grid.
 */
export function watermarkAnchors(pageW: number, pageH: number, w: number, h: number, angle: number, mode: "center" | "tile") {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const anchor = (cx: number, cy: number) => ({ x: cx - (cos * w) / 2 + (sin * h) / 2, y: cy - (sin * w) / 2 - (cos * h) / 2 });
  if (mode === "center") return [anchor(pageW / 2, pageH / 2)];
  const stepU = w + Math.max(h * 2, w * 0.35);
  const stepV = h * 4;
  const reach = Math.hypot(pageW, pageH);
  const out: { x: number; y: number }[] = [];
  for (let j = -Math.ceil(reach / stepV); j <= Math.ceil(reach / stepV); j++) {
    for (let i = -Math.ceil(reach / stepU) - 1; i <= Math.ceil(reach / stepU) + 1; i++) {
      // Lattice point in text direction (u) and perpendicular (v), brick-staggered rows.
      const u = i * stepU + (j % 2 ? stepU / 2 : 0);
      const v = j * stepV;
      const cx = pageW / 2 + u * cos - v * sin;
      const cy = pageH / 2 + u * sin + v * cos;
      if (cx > -w / 2 && cx < pageW + w / 2 && cy > -w / 2 && cy < pageH + w / 2) out.push(anchor(cx, cy));
    }
  }
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Bundled DejaVu Sans, fetched only when the text needs more than Latin-1. */
export async function loadUnicodeFont(): Promise<Uint8Array> {
  const { default: url } = await import("dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't load the font for this text");
  return new Uint8Array(await res.arrayBuffer());
}

export type FontLoader = () => Promise<Uint8Array>;

/** Helvetica covers Latin-1 (WinAnsi); anything else (ğ, ş, İ, Cyrillic…) gets subset DejaVu Sans. */
async function textFont(doc: PDFDocument, text: string, loadFont: FontLoader): Promise<PDFFont> {
  const { StandardFonts } = await import("pdf-lib");
  if (/^[\x20-\x7e\xa0-\xff]*$/.test(text)) return doc.embedFont(StandardFonts.Helvetica);
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  doc.registerFontkit(fontkit);
  return doc.embedFont(await loadFont(), { subset: true });
}

async function draw(page: PDFPage, text: string, at: { x: number; y: number }, angle: number, o: { font: PDFFont; size: number; color: string; opacity?: number }) {
  const { degrees, rgb } = await import("pdf-lib");
  const box = page.getCropBox();
  const rot = page.getRotation().angle;
  const p = toUserSpace(at.x, at.y, box, rot);
  page.drawText(text, {
    x: p.x,
    y: p.y,
    size: o.size,
    font: o.font,
    color: rgb(...hexToRgb(o.color)),
    opacity: o.opacity,
    // Undo the page's clockwise /Rotate so the text reads upright.
    rotate: degrees(normRotation(rot) + angle),
  });
}

export interface PageNumberOptions {
  spot: Spot;
  /** Template with {n} and {total}. */
  template: string;
  start: number;
  size: number;
  /** Distance from the page edges in points. */
  margin: number;
  color: string;
  skipFirst: boolean;
}

export async function addPageNumbers(bytes: Bytes, o: PageNumberOptions, loadFont: FontLoader = loadUnicodeFont): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const numbered = o.skipFirst ? pages.slice(1) : pages;
  const total = o.start + numbered.length - 1;
  const font = await textFont(doc, formatNumber(o.template, total, total), loadFont);
  const textH = font.heightAtSize(o.size, { descender: false });
  for (let i = 0; i < numbered.length; i++) {
    const page = numbered[i];
    const text = formatNumber(o.template, o.start + i, total);
    const { width, height } = visualSize(page.getCropBox(), page.getRotation().angle);
    const at = spotPosition(o.spot, width, height, font.widthOfTextAtSize(text, o.size), textH, o.margin);
    await draw(page, text, at, 0, { font, size: o.size, color: o.color });
  }
  return savePdf(doc);
}

export interface WatermarkOptions {
  text: string;
  size: number;
  /** 0..1 */
  opacity: number;
  /** Counter-clockwise degrees as seen on the page. */
  angle: number;
  color: string;
  mode: "center" | "tile";
  /** Pages to stamp, e.g. "1-3, last"; blank = all. */
  pages: string;
}

export async function addWatermark(bytes: Bytes, o: WatermarkOptions, loadFont: FontLoader = loadUnicodeFont): Promise<Uint8Array> {
  const text = o.text.trim();
  if (!text) throw new Error("Enter the watermark text");
  const doc = await loadPdf(bytes);
  const only = pageSelection(o.pages, doc.getPageCount());
  const font = await textFont(doc, text, loadFont);
  const w = font.widthOfTextAtSize(text, o.size);
  const h = font.heightAtSize(o.size, { descender: false });
  for (const [i, page] of doc.getPages().entries()) {
    if (only && !only.has(i)) continue;
    const { width, height } = visualSize(page.getCropBox(), page.getRotation().angle);
    for (const at of watermarkAnchors(width, height, w, h, o.angle, o.mode)) {
      await draw(page, text, at, o.angle, { font, size: o.size, color: o.color, opacity: o.opacity });
    }
  }
  return savePdf(doc);
}
