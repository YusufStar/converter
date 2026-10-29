import { FFFSType, FFmpeg, type LogEvent, type ProgressEvent } from "@ffmpeg/ffmpeg";
import stCoreURL from "@ffmpeg/core?url";
import stWasmURL from "@ffmpeg/core/wasm?url";
import mtCoreURL from "@ffmpeg/core-mt?url";
import mtWasmURL from "@ffmpeg/core-mt/wasm?url";
// Raw text, not ?url: Vite dev would inject an ES import into this classic worker script.
import mtWorkerSource from "@ffmpeg/core-mt/worker?raw";
import { splitName } from "../files";
import { MIME, failureMessage, parseInfo, threadCount, withThreads, type MediaInfo } from "./args";

export type EngineKind = "st" | "mt";

/** ffmpeg-core.wasm sizes, for download progress (gzip makes Content-Length useless). */
const CORES: Record<EngineKind, { core: string; wasm: string; worker?: string; bytes: number }> = {
  st: { core: stCoreURL, wasm: stWasmURL, bytes: 32_232_419 },
  mt: { core: mtCoreURL, wasm: mtWasmURL, worker: mtWorkerSource, bytes: 32_718_323 },
};

/**
 * The multi-threaded core needs SharedArrayBuffer, i.e. a cross-origin isolated page
 * (COOP + COEP headers; Safari isn't). Everything else gets the single-threaded core.
 */
export const PREFERRED: EngineKind = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated ? "mt" : "st";

// ---------------------------------------------------------------- load state (for the UI)

export interface EngineState {
  kind: EngineKind;
  /** Core bytes downloaded so far. */
  received: number;
  total: number;
  /** "download" → "start" (compile + spawn threads) → "ready". */
  phase: "idle" | "download" | "start" | "ready";
}

let state: EngineState = { kind: PREFERRED, received: 0, total: CORES[PREFERRED].bytes, phase: "idle" };
const listeners = new Set<() => void>();
const setState = (p: Partial<EngineState>) => {
  state = { ...state, ...p };
  listeners.forEach((fn) => fn());
};

export const engineState = () => state;
export function subscribeEngine(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export const engineReady = () => state.phase === "ready";

// ---------------------------------------------------------------- engines

const engines: Partial<Record<EngineKind, Promise<FFmpeg>>> = {};

/** Streams the wasm (so the UI can show MB progress) and starts one ffmpeg worker of `kind`, shared by every media tool. */
function load(kind: EngineKind): Promise<FFmpeg> {
  return (engines[kind] ??= (async () => {
    const c = CORES[kind];
    setState({ kind, received: 0, total: c.bytes, phase: "download" });
    const res = await fetch(c.wasm);
    if (!res.ok || !res.body) throw new Error(`Couldn't download the media engine (HTTP ${res.status})`);
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    let shown = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      // Re-render every ~256 KB, not per network chunk.
      if (received - shown > 262_144) setState({ received: (shown = received) });
    }
    setState({ received, phase: "start" });
    const url = URL.createObjectURL(new Blob(chunks, { type: "application/wasm" }));
    const ff = new FFmpeg();
    try {
      await ff.load({
        // Absolute: the thread workers import it from a blob: URL, where "/…" can't resolve.
        coreURL: new URL(c.core, location.href).href,
        wasmURL: url,
        // ponytail: never revoked — the thread pool may need it again; it's 2 KB.
        workerURL: c.worker ? URL.createObjectURL(new Blob([c.worker], { type: "text/javascript" })) : undefined,
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    setState({ phase: "ready" });
    return ff;
  })().catch((e) => {
    delete engines[kind];
    setState({ phase: "idle", received: 0 });
    throw e;
  }));
}

/**
 * Starts downloading + compiling the core in the background (call on tool mount) so
 * Convert doesn't wait. Safe to call repeatedly; a failure surfaces on the next run.
 */
export function preloadFFmpeg(): void {
  load(PREFERRED).catch(() => {});
}

const aborted = () => new DOMException("Cancelled", "AbortError");

/** Rejects as soon as `signal` aborts; the wrapped work keeps going (a half-loaded engine is still useful). */
function race<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(aborted());
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

export interface Plan {
  args: string[];
  /** Expected output length in seconds — drives the progress bar. */
  duration?: number;
  /** Small text files (e.g. a concat list) written into `io.work` before running: name → content. */
  write?: Record<string, string>;
}

export interface RunOptions {
  signal: AbortSignal;
  onProgress?: (p: number) => void;
  /** Force a core, e.g. "st" for an operation that misbehaves multi-threaded. */
  engine?: EngineKind;
}

export interface RunResult {
  /** Files ffmpeg wrote into the job's output folder, sorted by name. */
  files: { name: string; blob: Blob }[];
  /** Probe of the first input. */
  info: MediaInfo;
  infos: MediaInfo[];
}

export interface JobIO {
  /** First input's path + probe (the common single-file case). */
  input: string;
  info: MediaInfo;
  inputs: string[];
  infos: MediaInfo[];
  /** Output folder: every file written here is returned. */
  out: string;
  /** Scratch folder holding Plan.write files. */
  work: string;
}

/** A wasm trap / abort (not an ffmpeg error exit): the instance is dead. */
class EngineCrash extends Error {}

let jobs = 0;
// One job per worker at a time, so logs and progress never mix between tools.
let tail: Promise<unknown> = Promise.resolve();

/**
 * Mounts the inputs read-only (WORKERFS: no copy into wasm memory), probes each with
 * `ffmpeg -i`, asks `plan` for the real command, runs it and returns every file
 * written to the job's output folder (a null plan just probes). Cancelling terminates the worker; the next run
 * reloads it. A multi-threaded crash (e.g. its fixed 1 GB memory runs out) is retried
 * once on the single-threaded core, whose memory can grow to 2 GB.
 */
export async function runFFmpeg(file: File | File[], plan: (io: JobIO) => Plan | null, opts: RunOptions): Promise<RunResult> {
  const files = Array.isArray(file) ? file : [file];
  const prev = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => (release = r));
  try {
    await race(prev, opts.signal);
    const kind = opts.engine ?? PREFERRED;
    try {
      return await runOn(kind, files, plan, opts);
    } catch (e) {
      if (!(e instanceof EngineCrash) || kind === "st" || opts.signal.aborted) throw e;
      return await runOn("st", files, plan, opts);
    }
  } finally {
    release();
  }
}

async function runOn(kind: EngineKind, files: File[], plan: (io: JobIO) => Plan | null, opts: RunOptions): Promise<RunResult> {
  const { signal } = opts;
  const ff = await race(load(kind), signal);
  const id = ++jobs;
  const inDir = `/in${id}`;
  const out = `/out${id}`;
  const work = `/work${id}`;
  let dead = false;
  const kill = () => {
    dead = true;
    ff.terminate();
    delete engines[kind];
    setState({ phase: "idle", received: 0 });
  };
  signal.addEventListener("abort", kill, { once: true });
  let log: string[] = [];
  const onLog = ({ message }: LogEvent) => {
    log.push(message);
    if (log.length > 400) log = log.slice(-200);
  };
  ff.on("log", onLog);
  // A wasm trap (e.g. "memory access out of bounds") rejects exec and leaves the instance unusable: start fresh next time.
  const exec = (args: string[]) =>
    ff.exec(args).catch((e) => {
      kill();
      throw new EngineCrash(e instanceof Error ? e.message : String(e));
    });
  let mounted = false;
  try {
    await ff.createDir(inDir);
    await ff.createDir(out);
    await ff.createDir(work);
    const names = files.map((f, i) => {
      const ext = splitName(f.name).ext.replace(/[^a-z0-9]/g, "").slice(0, 8);
      return `${i}.${ext || "bin"}`;
    });
    await ff.mount(FFFSType.WORKERFS, { blobs: files.map((data, i) => ({ name: names[i], data })) }, inDir);
    mounted = true;
    const inputs = names.map((n) => `${inDir}/${n}`);

    // No output file: ffmpeg prints the stream info and exits 1.
    const infos: MediaInfo[] = [];
    for (const input of inputs) {
      log = [];
      await exec(["-hide_banner", "-i", input]);
      const info = parseInfo(log.join("\n"));
      if (!info.video && !info.audio) throw new Error(failureMessage(log));
      infos.push(info);
    }
    log = [];

    const p = plan({ input: inputs[0], info: infos[0], inputs, infos, out, work });
    if (!p) return { files: [], info: infos[0], infos };
    for (const [name, text] of Object.entries(p.write ?? {})) await ff.writeFile(`${work}/${name}`, text);
    const onProgress = ({ progress, time }: ProgressEvent) => {
      // `time` is µs of output written; ffmpeg's own `progress` is relative to the input length (wrong for trims).
      const v = p.duration ? time / 1e6 / p.duration : progress;
      if (Number.isFinite(v)) opts.onProgress?.(Math.min(1, Math.max(0, v)));
    };
    ff.on("progress", onProgress);
    const args = kind === "mt" ? withThreads(p.args, threadCount(navigator.hardwareConcurrency)) : p.args;
    const code = await exec(["-hide_banner", ...args]).finally(() => ff.off("progress", onProgress));
    if (code !== 0) throw new Error(failureMessage(log));

    const result: RunResult["files"] = [];
    for (const node of await ff.listDir(out)) {
      if (node.isDir) continue;
      const data = (await ff.readFile(`${out}/${node.name}`)) as Uint8Array<ArrayBuffer>;
      await ff.deleteFile(`${out}/${node.name}`);
      result.push({ name: node.name, blob: new Blob([data], { type: MIME[splitName(node.name).ext] ?? "application/octet-stream" }) });
    }
    if (!result.length) throw new Error(failureMessage(log));
    result.sort((a, b) => a.name.localeCompare(b.name));
    return { files: result, info: infos[0], infos };
  } catch (e) {
    if (signal.aborted) throw aborted();
    throw e;
  } finally {
    signal.removeEventListener("abort", kill);
    if (!dead) {
      ff.off("log", onLog);
      // Best effort: leave the in-memory FS clean for the next job.
      try {
        for (const dir of [out, work]) {
          for (const node of await ff.listDir(dir)) if (!node.isDir) await ff.deleteFile(`${dir}/${node.name}`);
          await ff.deleteDir(dir);
        }
        if (mounted) await ff.unmount(inDir);
        await ff.deleteDir(inDir);
      } catch {
        // ignore
      }
    }
  }
}
