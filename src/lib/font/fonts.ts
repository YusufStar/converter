// Worker pool for font jobs (WOFF2 encoding is Brotli at max quality: seconds for big fonts).

import type { ConvertOptions, ConvertResult, Inspected } from "./convert";
import type { FontJob } from "./font.worker";

const SIZE = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
export const FONT_WORKERS = SIZE;

const idle: Worker[] = [];
const waiting: ((w: Worker) => void)[] = [];
let alive = 0;

function spawn(): Worker {
  alive++;
  return new Worker(new URL("./font.worker.ts", import.meta.url), { type: "module" });
}

/** Starts one worker (and its wasm) in the background so the first job doesn't wait. */
export function warmUpFonts() {
  if (!alive) idle.push(spawn());
}

function acquire(): Promise<Worker> {
  const w = idle.pop();
  if (w) return Promise.resolve(w);
  if (alive < SIZE) return Promise.resolve(spawn());
  return new Promise((resolve) => waiting.push(resolve));
}

function release(w: Worker) {
  const next = waiting.shift();
  if (next) next(w);
  else idle.push(w);
}

function kill(w: Worker) {
  w.terminate();
  alive--;
  const next = waiting.shift();
  if (next) next(spawn());
}

async function run<T>(job: FontJob, signal?: AbortSignal): Promise<T> {
  const w = await acquire();
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      kill(w);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    w.onmessage = ({ data }) => {
      signal?.removeEventListener("abort", stop);
      release(w);
      if (data.ok) resolve(data.result);
      else reject(new Error(data.error));
    };
    w.onerror = (e) => {
      signal?.removeEventListener("abort", stop);
      kill(w);
      reject(new Error(e.message || "The font engine failed to load"));
    };
    w.postMessage(job, [job.bytes.buffer]);
  });
}

export const inspectFontFile = async (file: Blob) => run<Inspected>({ op: "inspect", bytes: new Uint8Array(await file.arrayBuffer()) });

export const convertFontFile = async (file: Blob, opts: ConvertOptions, signal?: AbortSignal) =>
  run<ConvertResult>({ op: "convert", bytes: new Uint8Array(await file.arrayBuffer()), opts }, signal);
