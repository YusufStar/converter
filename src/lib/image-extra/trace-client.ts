// Main-thread side of image → SVG: decode + downscale here, trace in workers.
import { decodeImage } from "../image/decode";
import { traceSize, type TraceJob, type TraceSettings } from "./trace";
import { WorkerPool } from "./worker-pool";

export function tracePool(size: number): WorkerPool {
  return new WorkerPool(() => new Worker(new URL("./trace.worker.ts", import.meta.url), { type: "module" }), size);
}

export interface Source {
  /** The image, at most `max` px on the long side. */
  canvas: HTMLCanvasElement;
  /** Original (EXIF-oriented) size. */
  width: number;
  height: number;
}

/** Decodes `file` once into a canvas no larger than `max` on the long side. */
export async function loadSource(file: File, max: number): Promise<Source> {
  const img = await decodeImage(file);
  try {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * k));
    canvas.height = Math.max(1, Math.round(img.height * k));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    return { canvas, width: img.width, height: img.height };
  } finally {
    img.close();
  }
}

/** Pixels at the size `s` traces at. */
export function pixelsAt(src: Source, s: Pick<TraceSettings, "size" | "colors" | "preset">): ImageData {
  const { width, height } = traceSize(src.width, src.height, s);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  // Pixel art stays blocky when scaled down; everything else is smoothed.
  ctx.imageSmoothingEnabled = s.preset !== "pixel";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.canvas, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  c.width = c.height = 0;
  return data;
}

export interface Traced {
  svg: string;
  paths: number;
}

/** Traces `pixels` in a pool worker; the SVG gets the original `width`×`height`. */
export function traceIn(pool: WorkerPool, pixels: ImageData, width: number, height: number, settings: TraceSettings, signal?: AbortSignal): Promise<Traced> {
  const job: TraceJob = { image: { width: pixels.width, height: pixels.height, data: pixels.data }, settings, width, height };
  return pool.run<Traced>(job, [pixels.data.buffer], signal);
}
