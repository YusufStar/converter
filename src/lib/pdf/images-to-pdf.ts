export type PageSizeId = "fit" | "a4" | "letter" | "legal" | "a3" | "a5";
export type Orientation = "auto" | "portrait" | "landscape";
export type ImageFit = "contain" | "cover" | "stretch";

/** Portrait page sizes in PDF points (1/72 in). */
export const PAGE_SIZES: Record<Exclude<PageSizeId, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
};

export interface PdfLayoutOptions {
  pageSize: PageSizeId;
  orientation: Orientation;
  /** Margin in points. */
  margin: number;
  fit: ImageFit;
}

export const DEFAULT_LAYOUT: PdfLayoutOptions = { pageSize: "a4", orientation: "auto", margin: 0, fit: "contain" };

/** 96 dpi CSS pixels → PDF points. */
const PT = 0.75;

/** Page size and image rectangle (top-left origin, points) for an image of imgW×imgH px. */
export function layoutImage(imgW: number, imgH: number, o: PdfLayoutOptions) {
  const iw = imgW * PT;
  const ih = imgH * PT;
  const m = Math.max(0, o.margin);
  if (o.pageSize === "fit") {
    return { pageW: iw + 2 * m, pageH: ih + 2 * m, x: m, y: m, w: iw, h: ih };
  }
  let [pageW, pageH] = PAGE_SIZES[o.pageSize];
  const landscape = o.orientation === "landscape" || (o.orientation === "auto" && imgW > imgH);
  if (landscape) [pageW, pageH] = [pageH, pageW];
  const boxW = Math.max(1, pageW - 2 * m);
  const boxH = Math.max(1, pageH - 2 * m);
  let w = boxW;
  let h = boxH;
  if (o.fit !== "stretch") {
    const f = o.fit === "contain" ? Math.min(boxW / iw, boxH / ih) : Math.max(boxW / iw, boxH / ih);
    w = iw * f;
    h = ih * f;
  }
  return { pageW, pageH, x: m + (boxW - w) / 2, y: m + (boxH - h) / 2, w, h };
}

export interface PdfImage {
  bytes: Uint8Array;
  kind: "jpg" | "png";
  /** Pixel size (used for layout). */
  width: number;
  height: number;
}

/** One page per image, in order. */
export async function imagesToPdf(images: PdfImage[], o: PdfLayoutOptions, onProgress?: (p: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setProducer("Converter");
  doc.setCreator("Converter");
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const embedded = im.kind === "jpg" ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes);
    const l = layoutImage(im.width, im.height, o);
    const page = doc.addPage([l.pageW, l.pageH]);
    // PDF origin is bottom-left.
    page.drawImage(embedded, { x: l.x, y: l.pageH - l.y - l.h, width: l.w, height: l.h });
    onProgress?.((i + 1) / images.length);
  }
  return doc.save({ useObjectStreams: true });
}
