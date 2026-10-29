/// <reference lib="webworker" />
// Hashes one File per job, streaming it in chunks (see hash-stream.ts).

import type { HashAlgo } from "./hash";
import { hashBlob } from "./hash-stream";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<{ file: Blob; algos: HashAlgo[] }>) => {
  try {
    let last = 0;
    const result = await hashBlob(e.data.file, e.data.algos, {
      onProgress: (p) => {
        // ~100 updates per file at most.
        if (p - last >= 0.01 || p === 1) {
          last = p;
          self.postMessage({ type: "progress", p });
        }
      },
    });
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
