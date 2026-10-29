import { renderToCanvas } from "./convert";
import type { Decoded } from "./decode";
import { ctx2d, makeCanvas } from "./encode";
import type { ResizeOptions, Size } from "./resize";

export interface Frame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A frame reduced to its own 256-colour palette, ready for the GIF writer. */
export interface QuantizedFrame {
  index: Uint8Array;
  palette: number[][];
  width: number;
  height: number;
}

export async function quantizeFrame(f: Frame): Promise<QuantizedFrame> {
  const { quantize, applyPalette } = await import("gifenc");
  const palette = quantize(f.data, 256);
  return { index: applyPalette(f.data, palette), palette, width: f.width, height: f.height };
}

/** Animated GIF from same-sized quantized frames. */
export async function writeGif(frames: QuantizedFrame[], { delay, loop }: { delay: number; loop: boolean }): Promise<Uint8Array> {
  if (!frames.length) throw new Error("No frames");
  const { GIFEncoder } = await import("gifenc");
  const gif = GIFEncoder();
  const { width, height } = frames[0];
  frames.forEach((f, i) => {
    if (f.width !== width || f.height !== height) throw new Error("All frames must have the same size");
    // repeat: 0 = loop forever, -1 = play once (only read from the first frame).
    gif.writeFrame(f.index, width, height, { palette: f.palette, delay, ...(i === 0 ? { repeat: loop ? 0 : -1 } : {}) });
  });
  gif.finish();
  return gif.bytes();
}

/**
 * Animated GIF from same-sized RGBA frames, each with its own 256-colour
 * palette (better colours than one global palette for photo slideshows).
 */
export async function makeAnimatedGif(frames: Frame[], opts: { delay: number; loop: boolean }): Promise<Uint8Array> {
  if (frames.some((f) => f.width !== frames[0].width || f.height !== frames[0].height)) throw new Error("All frames must have the same size");
  return writeGif(await Promise.all(frames.map(quantizeFrame)), opts);
}

/**
 * One slideshow frame: `file` resized, centred (contained) on a `frame`-sized canvas
 * filled with `background`, then quantized. Without `frame` the file sets the size.
 */
export async function gifFrame(file: File, o: { resize: ResizeOptions; background: string; frame?: Size }, pre?: Decoded): Promise<QuantizedFrame> {
  const src = await renderToCanvas(file, { resize: o.resize, rotate: 0, flipH: false, flipV: false, background: null }, undefined, pre);
  const { width, height } = o.frame ?? src;
  const c = makeCanvas(width, height);
  const g = ctx2d(c);
  g.fillStyle = o.background;
  g.fillRect(0, 0, width, height);
  const f = Math.min(width / src.width, height / src.height);
  const w = Math.round(src.width * f);
  const h = Math.round(src.height * f);
  g.imageSmoothingQuality = "high";
  g.drawImage(src, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
  src.width = src.height = 0;
  return quantizeFrame({ data: g.getImageData(0, 0, width, height).data, width, height });
}
