// pdf.js for rendering and text extraction (browser only). Loaded on demand;
// one shared worker serves every document.
import type { PDFDocumentProxy, PDFPageProxy, PDFWorker } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ENCRYPTED } from "./edit";

type PdfJs = typeof import("pdfjs-dist");

// CMaps (CJK text), the 14 standard fonts and the JBIG2/JPEG 2000 decoders,
// emitted as hashed assets and only fetched when a PDF needs them.
const ASSETS = import.meta.glob<string>(
  ["/node_modules/pdfjs-dist/cmaps/*.bcmap", "/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}", "/node_modules/pdfjs-dist/wasm/{jbig2,openjpeg}.wasm"],
  { query: "?url&no-inline", import: "default", eager: true },
);
const ASSET_BY_NAME = new Map(Object.entries(ASSETS).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]));

/** Hands pdf.js its data files by name instead of a base URL. */
class AssetFactory {
  async fetch({ filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = ASSET_BY_NAME.get(filename);
    if (!url) throw new Error(`Missing pdf.js data file ${filename}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't load ${filename}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

let loading: Promise<{ lib: PdfJs; worker: PDFWorker }> | null = null;

export function pdfjs() {
  loading ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return { lib, worker: new lib.PDFWorker() };
  });
  return loading;
}

/** Opens a PDF for rendering. The caller must `closePdf()` it when done. */
export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const { lib, worker } = await pdfjs();
  const task = lib.getDocument({ data, worker, BinaryDataFactory: AssetFactory, useWorkerFetch: false, cMapPacked: true });
  try {
    return await task.promise;
  } catch (e) {
    void task.destroy();
    if ((e as Error)?.name === "PasswordException") throw new Error(ENCRYPTED);
    throw new Error(`This file isn't a readable PDF (${(e as Error)?.message ?? e})`);
  }
}

/** Frees the document in the worker (pdf.js v6 moved destroy() to the loading task). */
export const closePdf = (doc: PDFDocumentProxy) => doc.loadingTask.destroy();

export async function openFile(file: File) {
  return openPdf(new Uint8Array(await file.arrayBuffer()));
}

// Browsers refuse canvases much past ~16k px a side or ~268M px (Safari: 16.7M px).
const MAX_SIDE = 12_000;
const MAX_PIXELS = 36e6;

/** Largest scale ≤ `scale` whose canvas the browser can still allocate. */
export function safeScale(page: PDFPageProxy, scale: number): number {
  const v = page.getViewport({ scale: 1 });
  return Math.min(scale, MAX_SIDE / v.width, MAX_SIDE / v.height, Math.sqrt(MAX_PIXELS / (v.width * v.height)));
}

/** Renders a page (with its /Rotate applied) onto a new canvas. */
export async function renderPage(
  page: PDFPageProxy,
  scale: number,
  o: { background?: string; signal?: AbortSignal } = {},
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: safeScale(page, scale) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const task = page.render({ canvas, viewport, background: o.background ?? "#ffffff" });
  const abort = () => task.cancel();
  o.signal?.addEventListener("abort", abort, { once: true });
  try {
    await task.promise;
  } finally {
    o.signal?.removeEventListener("abort", abort);
  }
  o.signal?.throwIfAborted();
  return canvas;
}

/** Plain text of one page; pdf.js marks line ends with hasEOL. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if (!("str" in item)) continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
