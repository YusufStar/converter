// A small pool of module workers for CPU work (hashing, barcode reading). Workers answer
// each job with {type:"progress", p} messages and one {type:"done", result} or {type:"error"}.

export type WorkerReply<R> = { type: "progress"; p: number } | { type: "done"; result: R } | { type: "error"; message: string };

/** Workers to run side by side: every core, capped so phones and 64-core boxes both behave. */
export const poolSize = (cap = 8) => Math.max(1, Math.min(cap, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4));

export class WorkerPool {
  private idle: Worker[] = [];
  private live = 0;
  private waiting: ((w: Worker) => void)[] = [];

  constructor(
    private spawn: () => Worker,
    readonly size: number,
  ) {}

  /** Starts one worker ahead of time so its script and wasm are ready on first use. */
  warm() {
    if (!this.idle.length && this.live < this.size) {
      this.idle.push(this.spawn());
      this.live++;
    }
  }

  private acquire(): Promise<Worker> {
    const w = this.idle.pop();
    if (w) return Promise.resolve(w);
    if (this.live < this.size) {
      this.live++;
      return Promise.resolve(this.spawn());
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(w: Worker) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  private discard(w: Worker) {
    w.terminate();
    this.live--;
    const next = this.waiting.shift();
    if (next) {
      this.live++;
      next(this.spawn());
    }
  }

  /** Runs one job; aborting terminates its worker (a fresh one replaces it on demand). */
  async run<R>(message: unknown, { transfer = [], onProgress, signal }: { transfer?: Transferable[]; onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<R> {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const w = await this.acquire();
    return new Promise<R>((resolve, reject) => {
      const cleanup = () => {
        w.onmessage = null;
        w.onerror = null;
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        this.discard(w);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      w.onmessage = (e: MessageEvent<WorkerReply<R>>) => {
        const msg = e.data;
        if (msg.type === "progress") return onProgress?.(msg.p);
        cleanup();
        this.release(w);
        if (msg.type === "done") resolve(msg.result);
        else reject(new Error(msg.message));
      };
      w.onerror = (e) => {
        e.preventDefault();
        cleanup();
        this.discard(w);
        reject(new Error(e.message || "Worker failed"));
      };
      w.postMessage(message, transfer);
    });
  }
}
