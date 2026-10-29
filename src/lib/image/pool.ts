import { rasterizeSvg } from "./convert";
import { NeedsDom } from "./decode";
import { warmCodecs } from "./encode";
import { inputKind } from "./formats";
import { jobs, type Jobs } from "./jobs";
import type { ResizeOptions } from "./resize";
import type { Request } from "./worker";

/** Image workers: every core but one (left for the UI), at most 6. */
export const POOL_SIZE = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency || 4) - 1));

/** Workers need OffscreenCanvas with a 2D context (all Chromium/Firefox, Safari 16.4+). */
export const workersSupported = (() => {
  try {
    return typeof Worker !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype && !!new OffscreenCanvas(1, 1).getContext("2d");
  } catch {
    return false;
  }
})();

/**
 * Files to process at once. AVIF/JXL encoders and LibRaw are multi-threaded WebAssembly
 * (each already spreads one file over several cores) and hold hundreds of MB each: half
 * the pool measured fastest for AVIF (12 photos on 10 cores: 1 → 5.8 s, 2 → 4.6 s, 3 → 3.4 s).
 */
export function concurrency(heavy = false): number {
  if (!workersSupported) return heavy ? 1 : 3; // main-thread fallback, as before the pool existed
  return heavy ? Math.max(1, Math.floor(POOL_SIZE / 2)) : POOL_SIZE;
}

type Args<K extends keyof Jobs> = Parameters<Jobs[K]> extends [File, unknown, ...infer A] ? A : never;
type Result<K extends keyof Jobs> = Awaited<ReturnType<Jobs[K]>>;

interface Slot {
  worker: Worker;
  busy: boolean;
}

const slots: Slot[] = [];
let waiting: (() => void)[] = [];
let nextId = 0;

const post = (slot: Slot, msg: Request, transfer: Transferable[] = []) => slot.worker.postMessage(msg, transfer);
const cancelled = () => new DOMException("Cancelled", "AbortError");

function spawn(): Slot {
  const slot = { worker: new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }), busy: false };
  slots.push(slot);
  return slot;
}

// Everyone waiting re-checks for a free slot (or their own abort).
function wake() {
  const w = waiting;
  waiting = [];
  w.forEach((r) => r());
}

function release(slot: Slot) {
  slot.busy = false;
  wake();
}

function kill(slot: Slot) {
  slot.worker.terminate();
  slots.splice(slots.indexOf(slot), 1);
  wake();
}

async function acquire(signal?: AbortSignal): Promise<Slot> {
  for (;;) {
    if (signal?.aborted) throw cancelled();
    const slot = slots.find((s) => !s.busy) ?? (slots.length < POOL_SIZE ? spawn() : null);
    if (slot) {
      slot.busy = true;
      return slot;
    }
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }
}

/**
 * Starts `count` workers and has each load the codecs `formats` need (see warmCodecs),
 * so pressing Convert doesn't wait for WebAssembly downloads.
 */
export function warmPool(formats: string[], count = POOL_SIZE) {
  if (!workersSupported) return void warmCodecs(formats);
  while (slots.length < count) spawn();
  for (const slot of slots.slice(0, count)) post(slot, { warm: formats });
}

/**
 * Runs `job` for `file` in a pooled worker; aborting terminates that worker.
 * SVGs are rasterised here first (at the size `resize` gives them). Without worker
 * support, or for a file only the DOM can decode, it runs on the main thread.
 */
export async function runJob<K extends keyof Jobs>(job: K, file: File, args: Args<K>, resize: ResizeOptions, signal?: AbortSignal): Promise<Result<K>> {
  const local = () => (jobs[job] as (file: File, pre: undefined, ...a: unknown[]) => Promise<Result<K>>)(file, undefined, ...args);
  if (!workersSupported) return local();
  const pre = inputKind(file) === "svg" ? await rasterizeSvg(file, resize) : undefined;
  let slot: Slot;
  try {
    slot = await acquire(signal);
  } catch (e) {
    pre?.close();
    throw e;
  }
  try {
    return await new Promise<Result<K>>((resolve, reject) => {
      const id = ++nextId;
      const done = () => {
        signal?.removeEventListener("abort", onAbort);
        slot.worker.onmessage = slot.worker.onerror = null;
      };
      const onAbort = () => {
        done();
        kill(slot);
        reject(cancelled());
      };
      slot.worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        done();
        release(slot);
        if (data.ok) resolve(data.value);
        else reject(data.dom ? new NeedsDom(data.error) : new Error(data.error));
      };
      slot.worker.onerror = (e) => {
        e.preventDefault();
        done();
        kill(slot);
        // A crashed or unloadable worker: retried on the main thread below.
        reject(new NeedsDom(e.message));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      post(slot, { id, job, file, args, pre }, pre ? [pre] : []);
    });
  } catch (e) {
    if (e instanceof NeedsDom && !signal?.aborted) return local();
    throw e;
  }
}
