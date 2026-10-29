// Tesseract OCR in the browser: a Scheduler over N workers, all code and wasm
// served from our origin, language data downloaded once (with progress) into
// the IndexedDB cache Tesseract itself reads from.
import type { ImageLike, PSM, Scheduler, Worker as TessWorker } from "tesseract.js";
import workerPath from "tesseract.js/dist/worker.min.js?url";
import coreBase from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import coreSimd from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import coreRelaxed from "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js?url";
import { createStore, download, gunzip } from "./download";
import { langDataUrl, workerCount } from "./ocr";

type Tess = typeof import("tesseract.js");

export interface OcrStatus {
  phase: "idle" | "download" | "starting" | "ready" | "error";
  /** Language data bytes, while downloading. */
  loaded: number;
  total: number;
  workers: number;
  error?: string;
}

export const ocrStatus = createStore<OcrStatus>({ phase: "idle", loaded: 0, total: 0, workers: 0 });

// --- language data in Tesseract's own cache (idb-keyval's default store) ---

const CACHE_PATH = "tessdata-4.0.0_best_int";
const cacheKey = (code: string) => `${CACHE_PATH}/${code}.traineddata`;

function idb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("keyval-store");
    open.onupgradeneeded = () => open.result.createObjectStore("keyval");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("keyval", mode);
      const req = fn(tx.objectStore("keyval"));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error("Your browser blocked storage for OCR language data"));
      };
    };
  });
}

const hasLang = (code: string) => idb("readonly", (s) => s.count(cacheKey(code))).then((n) => n > 0);

/** Downloads the languages not cached yet, all at once, reporting combined bytes. */
async function ensureLangs(codes: string[], onBytes: (loaded: number, total: number) => void) {
  const missing = (await Promise.all(codes.map(async (c) => ((await hasLang(c)) ? null : c)))).filter((c): c is string => c !== null);
  if (!missing.length) return;
  const progress = new Map<string, [number, number]>();
  const report = () => {
    let loaded = 0;
    let total = 0;
    for (const [l, t] of progress.values()) {
      loaded += l;
      total += t;
    }
    onBytes(loaded, total);
  };
  await Promise.all(
    missing.map(async (code) => {
      // ~2 MB each; the estimate keeps the bar honest until the real length arrives.
      progress.set(code, [0, 2e6]);
      const gz = await download(langDataUrl(code), (l, t) => {
        progress.set(code, [l, t]);
        report();
      });
      const data = await gunzip(gz);
      await idb("readwrite", (s) => s.put(data, cacheKey(code)));
    }),
  );
}

// --- engine ---

// Feature probes from wasm-feature-detect (Apache-2.0): tiny modules using a SIMD / relaxed-SIMD opcode.
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);
const corePath = () => (WebAssembly.validate(RELAXED) ? coreRelaxed : WebAssembly.validate(SIMD) ? coreSimd : coreBase);

export interface OcrEngine {
  scheduler: Scheduler;
  workers: TessWorker[];
}

let current: { key: string; promise: Promise<OcrEngine> } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

async function start(langs: string[], isCurrent: () => boolean): Promise<OcrEngine> {
  const set = (s: Partial<OcrStatus>) => isCurrent() && ocrStatus.set({ ...ocrStatus.get(), ...s });
  const n = workerCount(navigator.hardwareConcurrency || 2, (navigator as Navigator & { deviceMemory?: number }).deviceMemory);
  set({ phase: "starting", loaded: 0, total: 0, workers: n, error: undefined });
  const [mod] = await Promise.all([
    import("tesseract.js") as Promise<Tess & { default?: Tess }>,
    ensureLangs(langs, (loaded, total) => set({ phase: "download", loaded, total })),
  ]);
  set({ phase: "starting" });
  const T = mod.default ?? mod;
  const options = {
    workerPath,
    corePath: corePath(),
    cachePath: CACHE_PATH,
    // Read the data we just stored; never write or delete it from inside the workers.
    cacheMethod: "readOnly",
    workerBlobURL: false,
    // Without a handler a failed job also throws an uncaught error on the page.
    errorHandler: () => {},
  };
  const settled = await Promise.allSettled(Array.from({ length: n }, () => T.createWorker(langs, T.OEM.LSTM_ONLY, options)));
  const workers = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = settled.find((r) => r.status === "rejected");
  if (failed) {
    await Promise.all(workers.map((w) => w.terminate()));
    // Possibly corrupt language data: drop it so the next try downloads it again.
    await Promise.all(langs.map((c) => idb("readwrite", (s) => s.delete(cacheKey(c))).catch(() => {})));
    throw new Error(`The OCR engine failed to start (${String((failed as PromiseRejectedResult).reason)})`);
  }
  const scheduler = T.createScheduler();
  workers.forEach((w) => scheduler.addWorker(w));
  set({ phase: "ready" });
  return { scheduler, workers };
}

/**
 * The shared engine for `langs` (started on first call, reused after). Asking for
 * other languages replaces it. Safe to call on mount to warm everything up.
 */
export function ocrEngine(langs: string[]): Promise<OcrEngine> {
  clearTimeout(idleTimer);
  const key = [...langs].sort().join("+");
  if (current?.key === key) return current.promise;
  void current?.promise.then((e) => e.scheduler.terminate(), () => {});
  const entry = { key, promise: Promise.resolve({} as OcrEngine) };
  const isCurrent = () => current === entry;
  current = entry;
  entry.promise = start(langs, isCurrent).catch((e: unknown) => {
    if (isCurrent()) {
      current = null;
      ocrStatus.set({ ...ocrStatus.get(), phase: "error", error: e instanceof Error ? e.message : String(e) });
    }
    throw e;
  });
  return entry.promise;
}

/** Called when an OCR screen unmounts: the workers (and their memory) go after a quiet minute. */
export function releaseOcr() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void current?.promise.then((e) => e.scheduler.terminate(), () => {});
    current = null;
    ocrStatus.set({ phase: "idle", loaded: 0, total: 0, workers: 0 });
  }, 60_000);
}

export interface OcrResult {
  text: string;
  confidence: number;
  /** One-page text-only PDF (invisible text) when asked for. */
  pdf: Uint8Array | null;
}

/**
 * Sets the layout mode and resolution on every worker before a run. Input is fed at
 * roughly 300 dpi (PDF pages exactly); without a value Tesseract guesses and logs about it.
 */
export async function setOcrParams(engine: OcrEngine, psm: string, dpi = 300) {
  await Promise.all(engine.workers.map((w) => w.setParameters({ tessedit_pageseg_mode: psm as PSM, user_defined_dpi: String(dpi) })));
}

/** Queues one image (PGM/PNG/JPEG bytes) on the next free worker. */
export async function recognize(engine: OcrEngine, image: Uint8Array, pdf = false): Promise<OcrResult> {
  const { data } = await engine.scheduler.addJob("recognize", image as unknown as ImageLike, { pdfTextOnly: true }, { text: true, pdf });
  return { text: data.text ?? "", confidence: data.confidence ?? 0, pdf: data.pdf ? new Uint8Array(data.pdf) : null };
}
