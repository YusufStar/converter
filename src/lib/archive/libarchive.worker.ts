import factory from "libarchive.js/src/webworker/wasm-gen/libarchive.js";
import { bindLibarchive, LaError, type WriteKind } from "./libarchive-core";

export type Job =
  /** `paths`: which files to decompress ("all", a list, or none = list only). */
  | { op: "read"; file: Blob; password?: string; paths?: "all" | string[] }
  | { op: "write"; files: { path: string; data: Uint8Array }[]; kind: WriteKind };

// Loading starts as soon as the worker exists, so a pre-spawned worker is warm.
const ready = factory({ print() {}, printErr() {} }).then(bindLibarchive);

self.onmessage = async ({ data: job }: MessageEvent<Job>) => {
  try {
    const la = await ready;
    if (job.op === "write") {
      const out = la.write(job.files, job.kind);
      postMessage({ ok: true, result: out }, [out.buffer]);
      return;
    }
    const only = Array.isArray(job.paths) ? new Set(job.paths) : null;
    const entries = la.read(new Uint8Array(await job.file.arrayBuffer()), {
      password: job.password,
      want: job.paths === "all" ? () => true : only ? (p) => only.has(p) : undefined,
    });
    postMessage({ ok: true, result: entries }, entries.flatMap((e) => (e.data ? [e.data.buffer] : [])));
  } catch (e) {
    postMessage({ ok: false, code: e instanceof LaError ? e.code : "failed", message: e instanceof Error ? e.message : String(e) });
  }
};
