import { convertImage, prepareForPdf, type ImageOptions } from "./convert";
import type { Decoded } from "./decode";
import { gifFrame } from "./gif";
import type { ResizeOptions, Size } from "./resize";

/**
 * Per-file work the image pool runs, in a worker or (fallback) on the main thread.
 * `pre` is an SVG the main thread already rasterised (workers have no <img>).
 */
export const jobs = {
  convert: (file: File, pre: Decoded | undefined, o: ImageOptions) => convertImage(file, o, pre),
  pdf: (file: File, pre: Decoded | undefined, quality: "original" | number, resize: ResizeOptions) => prepareForPdf(file, quality, resize, pre),
  gifFrame: (file: File, pre: Decoded | undefined, o: { resize: ResizeOptions; background: string; frame?: Size }) => gifFrame(file, o, pre),
};

export type Jobs = typeof jobs;
