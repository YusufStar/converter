import { splitName } from "../files";
import { imagesToPdf, type PdfLayoutOptions } from "../pdf/images-to-pdf";
import { decodeImage, decodeSvg, type Decoded } from "./decode";
import { canvasToBlob, encodeCanvas, type EncodeOptions } from "./encode";
import { FORMATS, inputKind, resolveFormat, type ImageFormat, type OutputFormat } from "./formats";
import { jpegOrientation, jpegSize } from "./jpeg";
import { DEFAULT_RESIZE, targetSize, type ResizeOptions } from "./resize";
import { sizeSvg, svgIntrinsicSize } from "./svg";

export type Rotation = 0 | 90 | 180 | 270;

export interface RenderOptions {
  resize: ResizeOptions;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  /** Fill colour behind transparent pixels, or null to keep transparency. */
  background: string | null;
}

export interface ImageOptions extends RenderOptions, EncodeOptions {
  format: OutputFormat;
  /** Search the highest quality that fits under this size (lossy formats + PNG colours). */
  targetKB: number | null;
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  format: "png",
  quality: 85,
  lossless: false,
  pngColors: 0,
  icoSizes: [16, 32, 48, 256],
  resize: DEFAULT_RESIZE,
  rotate: 0,
  flipH: false,
  flipV: false,
  background: null,
  targetKB: null,
};

/** Step-down resampling: halving first keeps large reductions sharp and alias-free. */
function drawResampled(ctx: CanvasRenderingContext2D, src: Decoded, dx: number, dy: number, dw: number, dh: number) {
  let cur: CanvasImageSource = src.source;
  let cw = src.width;
  let ch = src.height;
  while (cw / 2 >= dw && ch / 2 >= dh && cw > 2 && ch > 2) {
    const nw = Math.max(dw, Math.round(cw / 2));
    const nh = Math.max(dh, Math.round(ch / 2));
    const step = document.createElement("canvas");
    step.width = nw;
    step.height = nh;
    const sctx = step.getContext("2d")!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(cur, 0, 0, nw, nh);
    cur = step;
    cw = nw;
    ch = nh;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, dx, dy, dw, dh);
}

/**
 * Decodes `file` and draws it resized/rotated/flipped onto a new canvas.
 * SVGs are re-sized as vectors before rasterising, so any scale stays crisp.
 */
export async function renderToCanvas(file: File, o: RenderOptions, forceBackground?: string): Promise<HTMLCanvasElement> {
  let decoded: Decoded;
  let size: { width: number; height: number };
  if (inputKind(file) === "svg") {
    const text = await file.text();
    size = targetSize(svgIntrinsicSize(text), o.resize, true);
    decoded = await decodeSvg(sizeSvg(text, size.width, size.height), size.width, size.height);
  } else {
    decoded = await decodeImage(file);
    size = targetSize({ width: decoded.width, height: decoded.height }, o.resize);
  }
  try {
    const turned = o.rotate === 90 || o.rotate === 270;
    const canvas = document.createElement("canvas");
    canvas.width = turned ? size.height : size.width;
    canvas.height = turned ? size.width : size.height;
    const ctx = canvas.getContext("2d")!;
    const bg = forceBackground ?? o.background;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((o.rotate * Math.PI) / 180);
    ctx.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
    drawResampled(ctx, decoded, -size.width / 2, -size.height / 2, size.width, size.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  } finally {
    decoded.close();
  }
}

const LOSSY: ImageFormat[] = ["jpg", "webp", "avif", "pdf"];

async function encodePdf(canvas: HTMLCanvasElement, quality: number, layout?: PdfLayoutOptions): Promise<Blob> {
  const jpg = await canvasToBlob(canvas, "image/jpeg", quality / 100);
  const bytes = await imagesToPdf(
    [{ bytes: new Uint8Array(await jpg.arrayBuffer()), kind: "jpg", width: canvas.width, height: canvas.height }],
    layout ?? { pageSize: "fit", orientation: "auto", margin: 0, fit: "contain" },
  );
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

async function encodeAt(canvas: HTMLCanvasElement, format: ImageFormat, o: EncodeOptions): Promise<Blob> {
  return format === "pdf" ? encodePdf(canvas, o.quality) : encodeCanvas(canvas, format, o);
}

/** Highest quality whose output fits `limit` bytes (binary search), or the smallest possible. */
async function fitToSize(canvas: HTMLCanvasElement, format: ImageFormat, o: EncodeOptions, limit: number): Promise<{ blob: Blob; missed: boolean }> {
  if (format === "png") {
    let last: Blob | null = null;
    for (const colors of [0, 256, 128, 64, 32, 16, 8]) {
      last = await encodeCanvas(canvas, "png", { ...o, pngColors: colors });
      if (last.size <= limit) return { blob: last, missed: false };
    }
    return { blob: last!, missed: true };
  }
  const first = await encodeAt(canvas, format, o);
  if (first.size <= limit) return { blob: first, missed: false };
  let lo = 1;
  let hi = o.quality - 1;
  let best: Blob | null = null;
  let smallest = first;
  for (let i = 0; i < 7 && lo <= hi; i++) {
    const mid = Math.round((lo + hi) / 2);
    const b = await encodeAt(canvas, format, { ...o, quality: mid, lossless: false });
    if (b.size < smallest.size) smallest = b;
    if (b.size <= limit) {
      best = b;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best ? { blob: best, missed: false } : { blob: smallest, missed: true };
}

export interface ConvertedImage {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  /** A target size was requested but even the lowest quality is larger. */
  targetMissed: boolean;
}

export async function convertImage(file: File, o: ImageOptions): Promise<ConvertedImage> {
  const format = resolveFormat(o.format, file);
  const info = FORMATS[format];
  // Formats without alpha get a background (white unless the user picked one).
  const canvas = await renderToCanvas(file, o, info.alpha ? undefined : (o.background ?? "#ffffff"));
  try {
    let result: { blob: Blob; missed: boolean };
    if (o.targetKB && o.targetKB > 0 && (LOSSY.includes(format) || format === "png")) {
      result = await fitToSize(canvas, format, o, o.targetKB * 1024);
    } else {
      result = { blob: await encodeAt(canvas, format, o), missed: false };
    }
    return {
      blob: result.blob,
      name: `${splitName(file.name).base}.${info.ext}`,
      width: canvas.width,
      height: canvas.height,
      targetMissed: result.missed,
    };
  } finally {
    canvas.width = canvas.height = 0; // free the backing store right away
  }
}

/** PNG width/height from the IHDR chunk, or null. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/**
 * Bytes ready for pdf-lib. With quality "original", JPEG/PNG files are
 * embedded untouched (no re-compression); everything else is re-encoded.
 */
export async function prepareForPdf(
  file: File,
  quality: "original" | number,
  resize: ResizeOptions = DEFAULT_RESIZE,
): Promise<{ bytes: Uint8Array; kind: "jpg" | "png"; width: number; height: number }> {
  const untouched = quality === "original" && resize.mode === "original";
  if (untouched && /^image\/(jpeg|png)$/.test(file.type)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === "image/jpeg") {
      const size = jpegSize(bytes);
      // EXIF-rotated JPEGs must be redrawn; PDFs ignore EXIF.
      if (size && jpegOrientation(bytes) === 1) return { bytes, kind: "jpg", ...size };
    } else {
      const size = pngSize(bytes);
      if (size) return { bytes, kind: "png", ...size };
    }
  }
  const canvas = await renderToCanvas(file, { resize, rotate: 0, flipH: false, flipV: false, background: null });
  try {
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let alpha = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { alpha = true; break; }
    if (alpha && quality === "original") {
      const png = await canvasToBlob(canvas, "image/png");
      return { bytes: new Uint8Array(await png.arrayBuffer()), kind: "png", width: canvas.width, height: canvas.height };
    }
    if (alpha) {
      // Flatten onto white for JPEG.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const jpg = await canvasToBlob(canvas, "image/jpeg", (quality === "original" ? 92 : quality) / 100);
    return { bytes: new Uint8Array(await jpg.arrayBuffer()), kind: "jpg", width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = canvas.height = 0;
  }
}
