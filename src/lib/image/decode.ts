import { inputKind } from "./formats";

export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

function fromBitmap(bmp: ImageBitmap): Decoded {
  return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
}

async function fromImgElement(blob: Blob): Promise<Decoded> {
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

async function decodeTiff(file: Blob): Promise<Decoded> {
  const UTIF = (await import("utif")).default;
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error("Empty TIFF file");
  UTIF.decodeImage(buf, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const { width, height } = ifds[0];
  const data = new ImageData(new Uint8ClampedArray(rgba), width, height);
  return fromBitmap(await createImageBitmap(data));
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

/** Decodes any raster input (not SVG — see decodeSvg) with EXIF orientation applied. */
export async function decodeImage(file: File): Promise<Decoded> {
  const kind = inputKind(file);
  if (kind === "tiff") return decodeTiff(file);
  if (kind === "heic") return decodeHeic(file);
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
