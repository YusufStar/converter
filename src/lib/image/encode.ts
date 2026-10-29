import { encodeBmp } from "./bmp";
import { FORMATS, type ImageFormat } from "./formats";
import { encodeIco } from "./ico";

export interface EncodeOptions {
  /** 1..100, used by JPG / WEBP / AVIF / JXL. */
  quality: number;
  /** WEBP / AVIF / JXL lossless mode. */
  lossless: boolean;
  /** PNG: 0 = lossless, otherwise reduce to N colours (2..256) like TinyPNG. */
  pngColors: number;
  /** ICO: sizes to embed. */
  icoSizes: number[];
}

/** A DOM canvas on the main thread, an OffscreenCanvas inside image workers. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof document === "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export const ctx2d = (c: AnyCanvas) => c.getContext("2d") as CanvasRenderingContext2D;

export function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  const fail = () => new Error("The browser could not encode this image (too large?)");
  if (!("toBlob" in canvas)) return canvas.convertToBlob({ type, quality }).catch(() => Promise.reject(fail()));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(fail())), type, quality));
}

export function pixels(canvas: AnyCanvas): ImageData {
  return ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export function hasTransparency(data: ImageData): boolean {
  const d = data.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

const blob = (bytes: Uint8Array | ArrayBuffer, type: string) => new Blob([bytes as BlobPart], { type });

/** One shared load per codec; a failed load (e.g. offline) is retried next time. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () =>
    (p ??= load().catch((e) => {
      p = undefined;
      throw e;
    }));
}

// init() first, so encode() never starts a second copy of the wasm while the first is compiling.
const webpEncoder = once(async () => {
  const m = await import("@jsquash/webp/encode");
  await m.init();
  return m.default;
});
const avifEncoder = once(async () => {
  const m = await import("@jsquash/avif/encode");
  await m.init();
  return m.default;
});
const jxlEncoder = once(async () => {
  const m = await import("@jsquash/jxl/encode");
  await m.init();
  return m.default;
});
export const jxlDecoder = once(async () => {
  const m = await import("@jsquash/jxl/decode");
  await m.init();
  return m.default;
});

/** Starts loading the WebAssembly codecs `formats` need, so the first convert doesn't wait. */
export function warmCodecs(formats: string[]): Promise<unknown> {
  const jobs: Promise<unknown>[] = [];
  if (formats.includes("webp")) jobs.push(webpEncoder());
  if (formats.includes("avif")) jobs.push(avifEncoder());
  if (formats.includes("jxl")) jobs.push(jxlEncoder());
  if (formats.includes("jxl-decode")) jobs.push(jxlDecoder());
  return Promise.allSettled(jobs);
}

async function encodeWebp(canvas: AnyCanvas, o: EncodeOptions): Promise<Blob> {
  if (!o.lossless) {
    // Native encoder first (fast, libwebp under the hood). Safari returns PNG instead → fall back to WASM.
    const native = await canvasToBlob(canvas, "image/webp", o.quality / 100);
    if (native.type === "image/webp") return native;
  }
  const encode = await webpEncoder();
  const out = await encode(pixels(canvas), o.lossless ? { lossless: 1, quality: 100, exact: 1 } : { quality: o.quality });
  return blob(out, "image/webp");
}

async function encodeAvif(canvas: AnyCanvas, o: EncodeOptions): Promise<Blob> {
  const encode = await avifEncoder();
  const out = await encode(pixels(canvas), o.lossless ? { lossless: true } : { quality: o.quality, speed: 7 });
  return blob(out, "image/avif");
}

async function encodeJxl(canvas: AnyCanvas, o: EncodeOptions): Promise<Blob> {
  const encode = await jxlEncoder();
  // effort 5 is libjxl's speed/size sweet spot for photos; the default 7 is ~3× slower for ~3%.
  const out = await encode(pixels(canvas), o.lossless ? { lossless: true, effort: 3 } : { quality: o.quality, effort: 5 });
  return blob(out, FORMATS.jxl.mime);
}

async function encodePng(canvas: AnyCanvas, o: EncodeOptions): Promise<Blob> {
  if (!o.pngColors) return canvasToBlob(canvas, "image/png");
  const UPNG = (await import("upng-js")).default;
  const data = pixels(canvas);
  const out = UPNG.encode([data.data.buffer as ArrayBuffer], canvas.width, canvas.height, Math.max(2, Math.min(256, o.pngColors)));
  return blob(out, "image/png");
}

async function encodeGif(canvas: AnyCanvas): Promise<Blob> {
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

async function encodeTiff(canvas: AnyCanvas): Promise<Blob> {
  const UTIF = (await import("utif")).default;
  const data = pixels(canvas);
  return blob(UTIF.encodeImage(data.data, canvas.width, canvas.height), "image/tiff");
}

/** Square, centred, transparent-padded copy of `src` at `size` px. */
export function squareCanvas<C extends AnyCanvas>(src: C, size: number): C {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = "high";
  const f = Math.min(size / src.width, size / src.height);
  const w = Math.round(src.width * f);
  const h = Math.round(src.height * f);
  ctx.drawImage(src, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  return c as C;
}

async function encodeIcoFile(canvas: AnyCanvas, o: EncodeOptions): Promise<Blob> {
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
export async function encodeCanvas(canvas: AnyCanvas, format: ImageFormat, o: EncodeOptions): Promise<Blob> {
  switch (format) {
    case "png":
      return encodePng(canvas, o);
    case "jpg":
      return canvasToBlob(canvas, "image/jpeg", o.quality / 100);
    case "webp":
      return encodeWebp(canvas, o);
    case "avif":
      return encodeAvif(canvas, o);
    case "jxl":
      return encodeJxl(canvas, o);
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
