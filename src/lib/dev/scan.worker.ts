/// <reference lib="webworker" />
// Reads QR codes and barcodes with zxing-wasm. Jobs carry either an image file (decoded here
// with createImageBitmap, so every format the browser knows works) or raw camera pixels.

import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { readingOrder, type ScanCode, type ScanJob, type ScanResult } from "./scan";

declare const self: DedicatedWorkerGlobalScope;

// The wasm is served from our own origin, never from the library's CDN default.
const ready = prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? new URL(wasmUrl, self.location.href).href : prefix + path) },
  fireImmediately: true,
});

const FILE_OPTIONS: ReaderOptions = { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 255 };
// Camera frames: fast settings, a missed frame is retried a few ms later anyway.
const CAMERA_OPTIONS: ReaderOptions = { tryHarder: false, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 16 };

async function pixels(blob: Blob): Promise<ImageData | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  const bmp = await createImageBitmap(blob);
  try {
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

self.onmessage = async (e: MessageEvent<ScanJob>) => {
  try {
    await ready;
    const job = e.data;
    let input: Blob | ImageData;
    if (job.kind === "file") {
      // No OffscreenCanvas (older Safari): zxing decodes PNG/JPEG/GIF/BMP itself.
      input = (await pixels(job.file).catch(() => null)) ?? job.file;
    } else input = new ImageData(new Uint8ClampedArray(job.buffer), job.width, job.height);
    const found = await readBarcodes(input, job.kind === "file" ? FILE_OPTIONS : CAMERA_OPTIONS);
    const codes: ScanCode[] = readingOrder(
      found.filter((r) => r.isValid).map((r) => ({ format: r.format, text: r.text, position: r.position, contentType: r.contentType })),
    );
    const result: ScanResult = { codes, width: input instanceof ImageData ? input.width : 0, height: input instanceof ImageData ? input.height : 0 };
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
