import { encodeBmp } from "./bmp";
import { FORMATS, type ImageFormat } from "./formats";
import { encodeIco } from "./ico";

export interface EncodeOptions {
  /** 1..100, used by JPG / WEBP / AVIF. */
  quality: number;
  /** WEBP / AVIF lossless mode. */
  lossless: boolean;
  /** PNG: 0 = lossless, otherwise reduce to N colours (2..256) like TinyPNG. */
  pngColors: number;
  /** ICO: sizes to embed. */
  icoSizes: number[];
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The browser could not encode this image (too large?)"))), type, quality),
  );
}

export function pixels(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
}

export function hasTransparency(data: ImageData): boolean {
  const d = data.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

const blob = (bytes: Uint8Array | ArrayBuffer, type: string) => new Blob([bytes as BlobPart], { type });

async function encodeWebp(canvas: HTMLCanvasElement, o: EncodeOptions): Promise<Blob> {
  if (!o.lossless) {
    // Native encoder first (fast, libwebp under the hood). Safari returns PNG instead → fall back to WASM.
    const native = await canvasToBlob(canvas, "image/webp", o.quality / 100);
    if (native.type === "image/webp") return native;
  }
  const { default: encode } = await import("@jsquash/webp/encode");
  const out = await encode(pixels(canvas), o.lossless ? { lossless: 1, quality: 100, exact: 1 } : { quality: o.quality });
  return blob(out, "image/webp");
}

async function encodeAvif(canvas: HTMLCanvasElement, o: EncodeOptions): Promise<Blob> {
  const { default: encode } = await import("@jsquash/avif/encode");
  const out = await encode(pixels(canvas), o.lossless ? { lossless: true } : { quality: o.quality, speed: 7 });
  return blob(out, "image/avif");
}

async function encodePng(canvas: HTMLCanvasElement, o: EncodeOptions): Promise<Blob> {
  if (!o.pngColors) return canvasToBlob(canvas, "image/png");
  const UPNG = (await import("upng-js")).default;
  const data = pixels(canvas);
  const out = UPNG.encode([data.data.buffer as ArrayBuffer], canvas.width, canvas.height, Math.max(2, Math.min(256, o.pngColors)));
  return blob(out, "image/png");
}

async function encodeGif(canvas: HTMLCanvasElement): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const data = pixels(canvas);
  const transparent = hasTransparency(data);
  const palette = quantize(data.data, 256, transparent ? { format: "rgba4444", oneBitAlpha: true } : undefined);
  const index = applyPalette(data.data, palette, transparent ? "rgba4444" : "rgb565");
  const gif = GIFEncoder();
  const transparentIndex = transparent ? palette.findIndex((c: number[]) => c[3] === 0) : -1;
  gif.writeFrame(index, canvas.width, canvas.height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  });
  gif.finish();
  return blob(gif.bytes(), "image/gif");
}

async function encodeTiff(canvas: HTMLCanvasElement): Promise<Blob> {
  const UTIF = (await import("utif")).default;
  const data = pixels(canvas);
  return blob(UTIF.encodeImage(data.data, canvas.width, canvas.height), "image/tiff");
}

/** Square, centred, transparent-padded copy of `src` at `size` px. */
export function squareCanvas(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const f = Math.min(size / src.width, size / src.height);
  const w = Math.round(src.width * f);
  const h = Math.round(src.height * f);
  ctx.drawImage(src, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  return c;
}

async function encodeIcoFile(canvas: HTMLCanvasElement, o: EncodeOptions): Promise<Blob> {
  const sizes = (o.icoSizes.length ? o.icoSizes : [16, 32, 48]).slice().sort((a, b) => a - b);
  const images = await Promise.all(
    sizes.map(async (size) => ({
      size,
      png: new Uint8Array(await (await canvasToBlob(squareCanvas(canvas, size), "image/png")).arrayBuffer()),
    })),
  );
  return blob(encodeIco(images), "image/x-icon");
}

/** Encodes a fully drawn canvas into `format` (PDF is handled by the caller). */
export async function encodeCanvas(canvas: HTMLCanvasElement, format: ImageFormat, o: EncodeOptions): Promise<Blob> {
  switch (format) {
    case "png":
      return encodePng(canvas, o);
    case "jpg":
      return canvasToBlob(canvas, "image/jpeg", o.quality / 100);
    case "webp":
      return encodeWebp(canvas, o);
    case "avif":
      return encodeAvif(canvas, o);
    case "gif":
      return encodeGif(canvas);
    case "bmp":
      return blob(encodeBmp(pixels(canvas).data, canvas.width, canvas.height), FORMATS.bmp.mime);
    case "tiff":
      return encodeTiff(canvas);
    case "ico":
      return encodeIcoFile(canvas, o);
    case "pdf":
      throw new Error("PDF is encoded by convertImage");
  }
}
