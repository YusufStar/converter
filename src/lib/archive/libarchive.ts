// Main-thread client for the libarchive worker (7z, RAR, TAR.XZ, ISO… and 7z / TAR.XZ writing).

import { LaError, type LaEntry, type WriteKind } from "./libarchive-core";
import type { Job } from "./libarchive.worker";

export { LaError, type LaEntry, type WriteKind };

const spawn = () => new Worker(new URL("./libarchive.worker.ts", import.meta.url), { type: "module" });

// One worker per job (wasm memory never shrinks, so a finished worker is dropped), plus one
// pre-spawned spare while a tool is open so jobs start with the wasm already loaded.
let spare: Worker | null = null;
let warm = 0;

/** Call on tool mount; returns the cleanup for unmount. */
export function warmUpLibarchive(): () => void {
  warm++;
  spare ??= spawn();
  return () => {
    if (--warm > 0) return;
    spare?.terminate();
    spare = null;
  };
}

function run<T>(job: Job, signal?: AbortSignal, transfer: Transferable[] = []): Promise<T> {
  const w = spare ?? spawn();
  spare = warm > 0 ? spawn() : null;
  return new Promise<T>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", stop);
      w.terminate();
    };
    const stop = () => {
      done();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    w.onmessage = ({ data }) => {
      done();
      if (data.ok) resolve(data.result);
      else reject(new LaError(data.code, data.message));
    };
    w.onerror = (e) => {
      done();
      reject(new LaError("failed", e.message || "The archive engine failed to load"));
    };
    w.postMessage(job, transfer);
  });
}

/** Lists files (path, size, encrypted) without decompressing anything. */
export const laList = (file: Blob, password?: string, signal?: AbortSignal) => run<LaEntry[]>({ op: "read", file, password }, signal);

/** Decompresses every file, or just `paths`. */
export const laExtract = (file: Blob, opts: { password?: string; paths?: string[] }, signal?: AbortSignal) =>
  run<LaEntry[]>({ op: "read", file, password: opts.password, paths: opts.paths ?? "all" }, signal).then((list) => list.filter((e) => e.data));

export const laWrite = (files: { path: string; data: Uint8Array }[], kind: WriteKind, signal?: AbortSignal) =>
  run<Uint8Array>({ op: "write", files, kind }, signal, files.map((f) => f.data.buffer));
