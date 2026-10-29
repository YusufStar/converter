import { ctx2d, jxlDecoder, makeCanvas } from "./encode";
import { inputKind } from "./formats";
import { jpegOrientation } from "./jpeg";
import { largestJpeg, tiffOrientation } from "./raw";

export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
  /** How a camera RAW was read: full LibRaw decode, or its embedded JPEG preview. */
  via?: "libraw" | "preview";
}

/** Raised (inside an image worker) when a file needs the DOM to decode; the caller retries on the main thread. */
export class NeedsDom extends Error {
  name = "NeedsDom";
}

export function fromBitmap(bmp: ImageBitmap): Decoded {
  return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
}

async function fromImgElement(blob: Blob): Promise<Decoded> {
  if (typeof Image === "undefined") throw new NeedsDom("needs <img>");
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This image can't be decoded by your browser");
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

const fromRgba = async (data: Uint8ClampedArray, width: number, height: number) =>
  fromBitmap(await createImageBitmap(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height)));

async function decodeTiff(file: Blob): Promise<Decoded> {
  const UTIF = (await import("utif")).default;
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error("Empty TIFF file");
  UTIF.decodeImage(buf, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const { width, height } = ifds[0];
  return fromRgba(new Uint8ClampedArray(rgba), width, height);
}

async function decodeHeic(file: Blob): Promise<Decoded> {
  // Safari decodes HEIC natively; everyone else gets libheif (WebAssembly, loaded on demand).
  try {
    return fromBitmap(await createImageBitmap(file));
  } catch {
    const { heicTo } = await import("heic-to");
    const bmp = (await heicTo({ blob: file, type: "bitmap" })) as ImageBitmap;
    return fromBitmap(bmp);
  }
}

async function decodeJxl(file: Blob): Promise<Decoded> {
  const decode = await jxlDecoder();
  const data = await decode(await file.arrayBuffer());
  return fromBitmap(await createImageBitmap(data));
}

/** 8-bit RGBA from ag-psd pixel data (8-bit, 16-bit or 32-bit float documents). */
function toRgba8(data: Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array): Uint8ClampedArray {
  if (data instanceof Uint8ClampedArray) return data;
  if (data instanceof Uint8Array) return new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const out = new Uint8ClampedArray(data.length);
  const scale = data instanceof Uint16Array ? 1 / 257 : 255;
  for (let i = 0; i < data.length; i++) out[i] = data[i] * scale;
  return out;
}

async function decodePsd(file: Blob): Promise<Decoded> {
  const psd = await import("ag-psd");
  // ag-psd needs a canvas factory for anything it decodes itself; inside a worker that's OffscreenCanvas.
  if (typeof document === "undefined") psd.initializeCanvas((w, h) => new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement, (w, h) => new ImageData(w, h));
  const buf = await file.arrayBuffer();
  const opts = { skipLayerImageData: true, skipLinkedFilesData: true, useImageData: true, useRawThumbnail: true };
  let doc: ReturnType<typeof psd.readPsd>;
  try {
    doc = psd.readPsd(buf, opts);
  } catch {
    // A composite in a mode ag-psd can't read (Lab, multichannel…): the thumbnail may still be there.
    doc = psd.readPsd(buf, { ...opts, skipCompositeImageData: true });
  }
  // The flattened composite. Saved without "Maximize compatibility" it's blank, and the small
  // JPEG thumbnail is all there is.
  if (doc.imageData && doc.imageResources?.versionInfo?.hasRealMergedData !== false)
    return fromRgba(toRgba8(doc.imageData.data), doc.imageData.width, doc.imageData.height);
  const thumb = doc.imageResources?.thumbnailRaw;
  if (thumb?.data.length) return fromBitmap(await createImageBitmap(new Blob([thumb.data as BlobPart], { type: "image/jpeg" })));
  throw new Error("This PSD has no flattened image — save it with “Maximize compatibility” on");
}

// EXIF orientation 2–8 as canvas transforms for a w×h source.
const ORIENT: Record<number, (w: number, h: number) => [number, number, number, number, number, number]> = {
  2: (w) => [-1, 0, 0, 1, w, 0],
  3: (w, h) => [-1, 0, 0, -1, w, h],
  4: (_, h) => [1, 0, 0, -1, 0, h],
  5: () => [0, 1, 1, 0, 0, 0],
  6: (_, h) => [0, 1, -1, 0, h, 0],
  7: (w, h) => [0, -1, -1, 0, h, w],
  8: (w) => [0, -1, 1, 0, 0, w],
};

/** Redraws `bmp` upright for EXIF orientation `o` (2–8). */
function orient(bmp: ImageBitmap, o: number): Decoded {
  const swap = o >= 5;
  const c = makeCanvas(swap ? bmp.height : bmp.width, swap ? bmp.width : bmp.height);
  const g = ctx2d(c);
  g.setTransform(...ORIENT[o](bmp.width, bmp.height));
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return { source: c, width: c.width, height: c.height, close: () => void (c.width = c.height = 0) };
}

async function rawPreview(bytes: Uint8Array): Promise<Decoded> {
  const preview = largestJpeg(bytes);
  if (!preview) throw new Error("No preview image found in this RAW file");
  const jpeg = new Blob([preview.bytes as BlobPart], { type: "image/jpeg" });
  // The preview's own EXIF orientation wins; otherwise the RAW's (previews are stored unrotated).
  const o = jpegOrientation(preview.bytes) === 1 ? tiffOrientation(bytes) : 1;
  const bmp = await createImageBitmap(jpeg, { imageOrientation: "from-image" });
  return { ...(o > 1 ? orient(bmp, o) : fromBitmap(bmp)), via: "preview" };
}

async function decodeRaw(file: Blob): Promise<Decoded> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // LibRaw-Wasm is a pthreads build: it needs SharedArrayBuffer (cross-origin isolation).
  if (globalThis.crossOriginIsolated) {
    const LibRaw = (await import("libraw-wasm")).default;
    const raw = new LibRaw();
    try {
      // LibRaw transfers the buffer it's given: hand it a copy and keep ours for the fallback.
      await raw.open(bytes.slice(), { useCameraWb: true, outputBps: 8 });
      const img = await raw.imageData();
      if (img && img.bits === 8 && img.colors >= 3) {
        const n = img.width * img.height;
        const src = img.data as Uint8Array;
        const rgba = new Uint8ClampedArray(n * 4);
        for (let i = 0, s = 0, d = 0; i < n; i++, s += img.colors, d += 4) {
          rgba[d] = src[s];
          rgba[d + 1] = src[s + 1];
          rgba[d + 2] = src[s + 2];
          rgba[d + 3] = 255;
        }
        return { ...(await fromRgba(rgba, img.width, img.height)), via: "libraw" };
      }
    } catch {
      // Camera or compression this LibRaw build can't decode: use the preview below.
    } finally {
      raw.dispose();
    }
  }
  return rawPreview(bytes);
}

/** Decodes any raster input (not SVG — see decodeSvg) with EXIF orientation applied. */
export async function decodeImage(file: File): Promise<Decoded> {
  const kind = inputKind(file);
  if (kind === "tiff") return decodeTiff(file);
  if (kind === "heic") return decodeHeic(file);
  if (kind === "jxl") return decodeJxl(file);
  if (kind === "psd") return decodePsd(file);
  if (kind === "raw") return decodeRaw(file);
  try {
    return fromBitmap(await createImageBitmap(file, { imageOrientation: "from-image" }));
  } catch {
    return fromImgElement(file);
  }
}

/** Loads already-sized SVG markup (see sizeSvg) as an image of exactly width×height. */
export async function decodeSvg(markup: string, width: number, height: number): Promise<Decoded> {
  const img = await fromImgElement(new Blob([markup], { type: "image/svg+xml" }));
  return { ...img, width, height };
}
