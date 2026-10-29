// OCR helpers that need no browser: languages, sizing, grayscale input for
// Tesseract and the searchable-PDF text layer (pdf-lib, so Node tests can run it).
import tessdata from "./tessdata.json";
import { loadPdf, savePdf } from "../pdf/edit";
import { normRotation, toUserSpace, visualSize, type Box } from "../pdf/stamp";

/** Tesseract language codes offered in the picker, with their own-language names (no translation needed). */
export const OCR_LANGS: { code: string; name: string }[] = [
  { code: "eng", name: "English" },
  { code: "tur", name: "Türkçe" },
  { code: "deu", name: "Deutsch" },
  { code: "fra", name: "Français" },
  { code: "spa", name: "Español" },
  { code: "por", name: "Português" },
  { code: "ita", name: "Italiano" },
  { code: "nld", name: "Nederlands" },
  { code: "pol", name: "Polski" },
  { code: "rus", name: "Русский" },
  { code: "ukr", name: "Українська" },
  { code: "ara", name: "العربية" },
  { code: "hin", name: "हिन्दी" },
  { code: "chi_sim", name: "简体中文" },
  { code: "jpn", name: "日本語" },
  { code: "kor", name: "한국어" },
];

const UI_TO_OCR: Record<string, string> = {
  en: "eng",
  tr: "tur",
  de: "deu",
  fr: "fra",
  es: "spa",
  pt: "por",
  it: "ita",
  nl: "nld",
  pl: "pol",
  ru: "rus",
  uk: "ukr",
  ar: "ara",
  hi: "hin",
  zh: "chi_sim",
  ja: "jpn",
  ko: "kor",
};

/** English plus the interface language (e.g. "tr" → eng + tur). */
export function defaultLangs(uiLang: string): string[] {
  const own = UI_TO_OCR[uiLang.toLowerCase().split("-")[0]];
  return own && own !== "eng" ? ["eng", own] : ["eng"];
}

/**
 * Language data: tessdata "best" quantised to int8 (better than "fast", smaller gzipped). Served
 * from our own origin: scripts/fetch-assets.mjs places the pinned files (tessdata.json, SHA-256
 * checked) in public/ before dev and build.
 */
export const langDataUrl = (code: string) => `/${tessdata.dir}/${code}.traineddata.gz`;

export type Psm = "auto" | "block" | "sparse";
/** Tesseract page segmentation modes behind the three choices. */
export const PSM: Record<Psm, string> = { auto: "3", block: "6", sparse: "11" };

/**
 * OCR workers to run side by side: one per spare core, at most 4, and fewer
 * on low-memory devices (each worker holds its own engine + language data).
 */
export function workerCount(cores: number, memoryGB: number | undefined): number {
  // ponytail: browsers that hide device memory (Safari, Firefox) are treated as 4 GB.
  const mem = memoryGB ?? 4;
  return Math.max(1, Math.min(4, cores - 1, Math.floor(mem / 2)));
}

/** Tesseract reads text best at ~300 dpi; more pixels than this cost memory without helping. */
export const OCR_MAX_PIXELS = 12e6;

/**
 * Scale for OCR input: PDF pages render at 300 dpi (scale 300/72 from points),
 * small images (screenshots) are doubled so their text is tall enough, and
 * everything is capped at OCR_MAX_PIXELS.
 */
export function ocrScale(width: number, height: number, kind: "pdf" | "image"): number {
  const want = kind === "pdf" ? 300 / 72 : Math.max(width, height) < 800 ? 2 : 1;
  return Math.min(want, Math.sqrt(OCR_MAX_PIXELS / (width * height)));
}

/**
 * RGBA pixels → binary PGM (P5). Tesseract binarises grayscale anyway, and
 * this is 4× smaller than RGBA with no encode/decode cost, unlike PNG.
 * Transparent pixels are composited on white.
 */
export function toPgm(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(header.length + width * height);
  out.set(header);
  for (let i = 0, o = header.length; i < width * height; i++, o++) {
    const p = i * 4;
    const y = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    out[o] = 255 - Math.round(((255 - y) * rgba[p + 3]) / 255);
  }
  return out;
}

export interface Placement {
  x: number;
  y: number;
  xScale: number;
  yScale: number;
  /** Counter-clockwise degrees, as pdf-lib's drawPage expects. */
  rotate: number;
}

/**
 * Where to draw a text-layer page (ew×eh, made from the page as the reader sees it)
 * so it lands exactly on a PDF page with visible box `box` and /Rotate `rotation`:
 * the reader's bottom-left corner in user space, turned back by the rotation.
 */
export function textLayerPlacement(box: Box, rotation: number, ew: number, eh: number): Placement {
  const r = normRotation(rotation);
  const vis = visualSize(box, r);
  const origin = toUserSpace(0, 0, box, r);
  return { x: origin.x, y: origin.y, xScale: vis.width / ew, yScale: vis.height / eh, rotate: r };
}

/**
 * Lays each page's invisible OCR text (a one-page text-only PDF from Tesseract)
 * over the original page. The page itself — scan image, vector art — is untouched.
 */
export async function addTextLayers(original: Uint8Array, layers: Map<number, Uint8Array>): Promise<Uint8Array> {
  const { degrees } = await import("pdf-lib");
  const doc = await loadPdf(original);
  for (const [index, bytes] of layers) {
    const page = doc.getPage(index);
    const [layer] = await doc.embedPdf(bytes, [0]);
    const p = textLayerPlacement(page.getCropBox(), page.getRotation().angle, layer.width, layer.height);
    page.drawPage(layer, { x: p.x, y: p.y, xScale: p.xScale, yScale: p.yScale, rotate: degrees(p.rotate) });
  }
  return savePdf(doc);
}
