// Structural PDF edits with pdf-lib: merge, split, organize, rotate, remove,
// lossless optimize, metadata. No DOM here, so everything runs in Node tests.
import type { PDFDocument, PDFObject } from "pdf-lib";
import { pageSelection, type SplitPart } from "./ranges";

import { ENCRYPTED } from "./errors";

export { ENCRYPTED };

type Bytes = Uint8Array | ArrayBuffer;
const lib = () => import("pdf-lib");

/** Loads a PDF, turning pdf-lib's errors into messages a person can act on. */
export async function loadPdf(bytes: Bytes): Promise<PDFDocument> {
  const { PDFDocument } = await lib();
  try {
    // updateMetadata: false keeps the author's title, producer and dates untouched.
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // pdf-lib is ES5 code, so `instanceof EncryptedPDFError` doesn't work; match its message.
    if (/is encrypted/.test(msg)) throw new Error(ENCRYPTED);
    throw new Error(`This file isn't a readable PDF (${msg})`);
  }
}

export async function createPdf(): Promise<PDFDocument> {
  const { PDFDocument } = await lib();
  const doc = await PDFDocument.create();
  doc.setProducer("Converter");
  doc.setCreator("Converter");
  return doc;
}

/**
 * Drops every object no longer reachable from the catalog or info dict.
 * pdf-lib writes all objects it ever loaded, so without this a PDF with
 * removed pages would stay just as large.
 */
export async function prune(doc: PDFDocument) {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = await lib();
  const { context } = doc;
  const seen = new Set<string>();
  const stack: (PDFObject | undefined)[] = [context.trailerInfo.Root, context.trailerInfo.Info];
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      stack.push(context.lookup(o));
    } else if (o instanceof PDFDict) stack.push(...o.values());
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFStream) stack.push(o.dict);
  }
  for (const [ref] of context.enumerateIndirectObjects()) if (!seen.has(ref.tag)) context.delete(ref);
}

export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  await doc.flush();
  await prune(doc);
  return doc.save({ useObjectStreams: true });
}

/** New document holding `indices` of `src`, in that order. */
export async function pickPages(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await createPdf();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: true });
}

export async function mergePdfs(files: Bytes[], onProgress?: (p: number) => void): Promise<{ bytes: Uint8Array; pages: number }> {
  if (!files.length) throw new Error("Add at least one PDF");
  const out = await createPdf();
  for (let i = 0; i < files.length; i++) {
    const src = await loadPdf(files[i]);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    onProgress?.((i + 1) / (files.length + 1));
  }
  const bytes = await out.save({ useObjectStreams: true });
  onProgress?.(1);
  return { bytes, pages: out.getPageCount() };
}

export async function splitPdf(src: PDFDocument, plan: SplitPart[], onProgress?: (p: number) => void) {
  const out: { suffix: string; bytes: Uint8Array; pages: number }[] = [];
  for (const part of plan) {
    out.push({ suffix: part.suffix, bytes: await pickPages(src, part.indices), pages: part.indices.length });
    onProgress?.(out.length / plan.length);
  }
  return out;
}

const norm = (deg: number) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

export interface PageEdit {
  /** 0-based page index in the source. */
  index: number;
  /** Extra clockwise rotation in degrees (multiple of 90). */
  rotate: number;
}

/**
 * Rebuilds the page order (dropping pages not listed) and applies rotations,
 * in place so bookmarks, forms and document info survive. Each page may be
 * listed once.
 */
export async function organizePdf(bytes: Bytes, edits: PageEdit[]): Promise<Uint8Array> {
  const { degrees } = await lib();
  if (!edits.length) throw new Error("Keep at least one page");
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  for (const e of edits) if (!pages[e.index]) throw new Error(`Page ${e.index + 1} doesn't exist`);
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  for (const e of edits) {
    const page = pages[e.index];
    page.setRotation(degrees(norm(page.getRotation().angle + e.rotate)));
    doc.addPage(page);
  }
  return savePdf(doc);
}

/** Rotates the pages named by `ranges` ("" = all) clockwise by `angle`. */
export async function rotatePdf(bytes: Bytes, angle: number, ranges = ""): Promise<Uint8Array> {
  const { degrees } = await lib();
  const doc = await loadPdf(bytes);
  const only = pageSelection(ranges, doc.getPageCount());
  doc.getPages().forEach((page, i) => {
    if (!only || only.has(i)) page.setRotation(degrees(norm(page.getRotation().angle + angle)));
  });
  return savePdf(doc);
}

/** Deletes the pages named by `ranges`, e.g. "2, 5-7, last". */
export async function removePages(bytes: Bytes, ranges: string): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await loadPdf(bytes);
  const total = doc.getPageCount();
  const remove = pageSelection(ranges, total);
  if (!remove?.size) throw new Error("Enter the pages to remove");
  if (remove.size >= total) throw new Error("You can't remove every page");
  for (let i = total - 1; i >= 0; i--) if (remove.has(i)) doc.removePage(i);
  return { bytes: await savePdf(doc), pages: doc.getPageCount() };
}

/**
 * Lossless size reduction: drops unreachable objects and old revisions,
 * deflates streams stored uncompressed and packs objects into object streams.
 */
export async function optimizePdf(bytes: Bytes): Promise<Uint8Array> {
  const { PDFName, PDFRawStream } = await lib();
  const { deflateSync } = await import("fflate");
  const doc = await loadPdf(bytes);
  await prune(doc);
  const filter = PDFName.of("Filter");
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(filter) || obj.contents.length < 64) continue;
    const packed = deflateSync(obj.contents, { level: 9 });
    if (packed.length >= obj.contents.length) continue;
    obj.dict.set(filter, PDFName.of("FlateDecode"));
    doc.context.assign(ref, PDFRawStream.of(obj.dict, packed));
  }
  return savePdf(doc);
}

/** A page re-rendered as JPEG, with its visible size in points. */
export interface RasterPage {
  jpg: Uint8Array;
  width: number;
  height: number;
}

/** Builds a PDF of full-page JPEGs (used by the strong compression levels). */
export async function pdfFromJpegs(pages: RasterPage[]): Promise<Uint8Array> {
  const out = await createPdf();
  for (const p of pages) {
    const img = await out.embedJpg(p.jpg);
    out.addPage([p.width, p.height]).drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
  }
  return out.save({ useObjectStreams: true });
}

export interface PdfMeta {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export const META_FIELDS = ["title", "author", "subject", "keywords", "creator", "producer"] as const;

export async function readMeta(bytes: Bytes): Promise<PdfMeta & { pages: number }> {
  const doc = await loadPdf(bytes);
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
    creator: doc.getCreator() ?? "",
    producer: doc.getProducer() ?? "",
    pages: doc.getPageCount(),
  };
}

/**
 * Writes the document info fields; empty strings remove a field. The XMP
 * metadata stream is dropped so viewers can't show stale values from it.
 */
export async function writeMeta(bytes: Bytes, meta: PdfMeta): Promise<Uint8Array> {
  const { PDFName, PDFDict, PDFHexString } = await lib();
  const doc = await loadPdf(bytes);
  doc.catalog.delete(PDFName.of("Metadata"));
  doc.setModificationDate(new Date()); // also creates the info dict when missing
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  for (const field of META_FIELDS) {
    const key = PDFName.of(field[0].toUpperCase() + field.slice(1));
    const value = meta[field].trim();
    if (value) info.set(key, PDFHexString.fromText(value));
    else info.delete(key);
  }
  return savePdf(doc);
}
