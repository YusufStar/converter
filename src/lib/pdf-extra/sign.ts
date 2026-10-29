// Signatures, initials, dates and text stamped onto PDF pages. Placements are
// stored as fractions of the page as the reader sees it (after /Rotate, inside
// the crop box) and mapped back to PDF user space when saving.
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { loadPdf, savePdf } from "../pdf/edit";
import { hexToRgb, loadUnicodeFont, normRotation, toUserSpace, visualSize, type FontLoader } from "../pdf/stamp";

type Bytes = Uint8Array | ArrayBuffer;

/** DejaVu Sans vertical metrics (hhea, 2048 units/em). The preview uses the same font and numbers. */
export const ASCENT = 1901 / 2048;
export const DESCENT = 483 / 2048;
/** Line box height in em: CSS `line-height` for the preview, font size = box height / LINE. */
export const LINE = ASCENT + DESCENT;

interface Box {
  id: string;
  /** 0-based page index. */
  page: number;
  /** Top-left corner and size as fractions (0..1) of the visible page. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Placement = (Box & { kind: "image"; image: string }) | (Box & { kind: "text"; text: string; color: string });

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Visible page box in points with its rotation, as pdf.js and readers show it. */
function frame(page: PDFPage) {
  const box = page.getCropBox();
  const rotation = normRotation(page.getRotation().angle);
  return { box, rotation, ...visualSize(box, rotation) };
}

/** Where pdf-lib must draw a placement's bottom-left corner, its size in points, and the rotation that keeps it upright. */
export function toPdf(p: Box, box: Rect, rotation: number) {
  const { width: W, height: H } = visualSize(box, rotation);
  const width = p.w * W;
  const height = p.h * H;
  const left = p.x * W;
  const top = p.y * H;
  return { at: toUserSpace(left, H - top - height, box, rotation), baseline: (size: number) => toUserSpace(left, H - top - ASCENT * size, box, rotation), width, height };
}

/**
 * Draws every placement. `images` maps a placement's `image` id to PNG bytes;
 * each image is embedded once however often it's placed.
 */
export async function signPdf(bytes: Bytes, placements: Placement[], images: Record<string, Uint8Array>, loadFont: FontLoader = loadUnicodeFont): Promise<Uint8Array> {
  const { degrees, rgb } = await import("pdf-lib");
  if (!placements.length) throw new Error("Place at least one item on the pages");
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const embedded = new Map<string, PDFImage>();
  let font: PDFFont | null = null;
  for (const p of placements) {
    const page = pages[p.page];
    if (!page) throw new Error(`Page ${p.page + 1} doesn't exist`);
    const { box, rotation } = frame(page);
    const spot = toPdf(p, box, rotation);
    if (p.kind === "image") {
      let img = embedded.get(p.image);
      if (!img) {
        const png = images[p.image];
        if (!png) throw new Error("Missing signature image");
        img = await doc.embedPng(png);
        embedded.set(p.image, img);
      }
      page.drawImage(img, { ...spot.at, width: spot.width, height: spot.height, rotate: degrees(rotation) });
    } else {
      if (!font) {
        const fontkit = (await import("@pdf-lib/fontkit")).default;
        doc.registerFontkit(fontkit);
        font = await doc.embedFont(await loadFont(), { subset: true });
      }
      const size = spot.height / LINE;
      page.drawText(p.text, { ...spot.baseline(size), size, font, color: rgb(...hexToRgb(p.color)), rotate: degrees(rotation) });
    }
  }
  return savePdf(doc);
}

// --- signature image helpers (pure pixel work, shared by the pad, typed and uploaded signatures) ---

/** Bounding box of pixels with alpha above `min`, or null when the image is empty. */
export function inkBounds(rgba: ArrayLike<number>, width: number, height: number, min = 8): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] <= min) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Makes the paper behind a scanned or photographed signature transparent, in
 * place. The paper tone is the median brightness (ink is a small part of the
 * picture), so grey-ish photos of white paper work too; pixels fade out over a
 * soft band above the ink so edges stay smooth.
 */
export function removePaper(rgba: Uint8ClampedArray) {
  const n = rgba.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])]++;
  let paper = 0;
  for (let seen = 0; paper < 255 && (seen += hist[paper]) < n / 2; paper++);
  paper = Math.max(paper, 150); // a dark picture has no white paper to remove; only near-white goes
  const clear = paper - 28;
  const solid = paper - 90;
  for (let i = 0; i < n; i++) {
    const v = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    const keep = v >= clear ? 0 : v <= solid ? 1 : (clear - v) / (clear - solid);
    rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * keep);
  }
}

/** "Yusuf Yıldız" → "YY", "ada" → "A". */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toLocaleUpperCase())
    .join("")
    .slice(0, 4);
}
