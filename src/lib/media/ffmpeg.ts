import { FFFSType, FFmpeg, type LogEvent, type ProgressEvent } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import { splitName } from "../files";
import { MIME, failureMessage, parseInfo, type MediaInfo } from "./args";

/** ffmpeg-core.wasm size, for download progress (gzip makes Content-Length useless). */
export const CORE_BYTES = 32_232_419;

let engine: Promise<FFmpeg> | null = null;
let onDownload: ((received: number) => void) | undefined;

export function engineReady(): boolean {
  return engine !== null;
}

/** Lazily starts the single ffmpeg worker; the 31 MB wasm is streamed so we can show progress. */
function load(): Promise<FFmpeg> {
  engine ??= (async () => {
    const res = await fetch(wasmURL);
    if (!res.ok || !res.body) throw new Error(`Couldn't download the media engine (HTTP ${res.status})`);
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onDownload?.(received);
    }
    const url = URL.createObjectURL(new Blob(chunks, { type: "application/wasm" }));
    const ff = new FFmpeg();
    try {
      await ff.load({ coreURL, wasmURL: url });
    } finally {
      URL.revokeObjectURL(url);
    }
    return ff;
  })().catch((e) => {
    engine = null;
    throw e;
  });
  return engine;
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
}

export interface RunOptions {
  signal: AbortSignal;
  onProgress?: (p: number) => void;
  /** Called while the engine downloads (bytes so far). */
  onLoading?: (received: number) => void;
}

export interface RunResult {
  /** Files ffmpeg wrote into the job folder, sorted by name. */
  files: { name: string; blob: Blob }[];
  info: MediaInfo;
}

let jobs = 0;

/**
 * Mounts `file` read-only (WORKERFS: no copy into wasm memory), probes it with
 * `ffmpeg -i`, asks `plan` for the real command, runs it and returns every file
 * written to the job's output folder. Cancelling terminates the worker; the next
 * run reloads it.
 */
export async function runFFmpeg(file: File, plan: (io: { input: string; out: string; info: MediaInfo }) => Plan, opts: RunOptions): Promise<RunResult> {
  const { signal } = opts;
  onDownload = opts.onLoading;
  const ff = await race(load(), signal);
  const id = ++jobs;
  const inDir = `/in${id}`;
  const out = `/out${id}`;
  const kill = () => {
    ff.terminate();
    engine = null;
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
      throw e instanceof Error ? e : new Error(String(e));
    });
  let mounted = false;
  try {
    await ff.createDir(inDir);
    await ff.createDir(out);
    const ext = splitName(file.name).ext.replace(/[^a-z0-9]/g, "").slice(0, 8);
    const name = `input.${ext || "bin"}`;
    await ff.mount(FFFSType.WORKERFS, { blobs: [{ name, data: file }] }, inDir);
    mounted = true;
    const input = `${inDir}/${name}`;

    // No output file: ffmpeg prints the stream info and exits 1.
    await exec(["-hide_banner", "-i", input]);
    const info = parseInfo(log.join("\n"));
    if (!info.video && !info.audio) throw new Error(failureMessage(log));
    log = [];

    const p = plan({ input, out, info });
    const onProgress = ({ progress, time }: ProgressEvent) => {
      // `time` is µs of output written; ffmpeg's own `progress` is relative to the input length (wrong for trims).
      const v = p.duration ? time / 1e6 / p.duration : progress;
      if (Number.isFinite(v)) opts.onProgress?.(Math.min(1, Math.max(0, v)));
    };
    ff.on("progress", onProgress);
    const code = await exec(["-hide_banner", ...p.args]).finally(() => ff.off("progress", onProgress));
    if (code !== 0) throw new Error(failureMessage(log));

    const files: RunResult["files"] = [];
    for (const node of await ff.listDir(out)) {
      if (node.isDir) continue;
      const data = (await ff.readFile(`${out}/${node.name}`)) as Uint8Array<ArrayBuffer>;
      await ff.deleteFile(`${out}/${node.name}`);
      files.push({ name: node.name, blob: new Blob([data], { type: MIME[splitName(node.name).ext] ?? "application/octet-stream" }) });
    }
    if (!files.length) throw new Error(failureMessage(log));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { files, info };
  } catch (e) {
    if (signal.aborted) throw aborted();
    throw e;
  } finally {
    signal.removeEventListener("abort", kill);
    if (!signal.aborted) {
      ff.off("log", onLog);
      // Best effort: leave the in-memory FS clean for the next job.
      try {
        for (const node of await ff.listDir(out)) if (!node.isDir) await ff.deleteFile(`${out}/${node.name}`);
        await ff.deleteDir(out);
        if (mounted) await ff.unmount(inDir);
        await ff.deleteDir(inDir);
      } catch {
        // ignore
      }
    }
  }
}
