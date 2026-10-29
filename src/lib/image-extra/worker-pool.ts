/** Default pool size: every core but one for the UI, capped (each worker holds a decoded image). */
export function poolSize(cap = 4): number {
  const cores = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(cap, cores - 1));
}

/**
 * Up to `size` workers created on demand, one job each at a time. Workers
 * answer with `{ ok: true, ... }` or `{ ok: false, error }`. Aborting a job
 * terminates its worker (the only way to stop CPU work) and replaces it.
 */
export class WorkerPool {
  private idle: Worker[] = [];
  private all = new Set<Worker>();
  private waiting: ((w: Worker) => void)[] = [];

  constructor(
    private create: () => Worker,
    readonly size: number,
  ) {}

  private spawn(): Worker {
    const w = this.create();
    this.all.add(w);
    return w;
  }

  /** Starts one worker so its code is loaded before the first job. */
  warm() {
    if (!this.all.size) this.idle.push(this.spawn());
  }

  private acquire(): Promise<Worker> {
    const w = this.idle.pop();
    if (w) return Promise.resolve(w);
    if (this.all.size < this.size) return Promise.resolve(this.spawn());
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(w: Worker) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  private discard(w: Worker) {
    w.terminate();
    this.all.delete(w);
    const next = this.waiting.shift();
    if (next) next(this.spawn());
  }

  async run<T>(msg: unknown, transfer: Transferable[] = [], signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const w = await this.acquire();
    if (signal?.aborted) {
      this.release(w);
      signal.throwIfAborted();
    }
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        w.onmessage = w.onerror = null;
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        done();
        this.discard(w);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      w.onmessage = (e: MessageEvent<{ ok: boolean; error?: string } & T>) => {
        done();
        this.release(w);
        if (e.data.ok) resolve(e.data);
        else reject(new Error(e.data.error ?? "Worker failed"));
      };
      w.onerror = (e) => {
        done();
        this.discard(w);
        reject(new Error(e.message || "Worker failed"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      w.postMessage(msg, transfer);
    });
  }

  terminate() {
    for (const w of this.all) w.terminate();
    this.all.clear();
    this.idle = [];
    this.waiting = [];
  }
}
