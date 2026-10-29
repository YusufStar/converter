import { woff2 } from "fonteditor-core";
import { convertFont, inspectFont, type ConvertOptions } from "./convert";

// Not in the package's "exports", so it's addressed by path. Served from our origin.
import wasmUrl from "../../../node_modules/fonteditor-core/woff2/woff2.wasm?url";

export type FontJob = { op: "inspect"; bytes: Uint8Array } | { op: "convert"; bytes: Uint8Array; opts: ConvertOptions };

// fonteditor's woff2 loader only uses the wasm URL we pass when it sees a `window`, so lend it
// one while the module loads (DOMParser / i18n already chose their non-window paths at import).
const ready = (async () => {
  const g = globalThis as { window?: unknown };
  g.window = globalThis;
  try {
    await woff2.init(wasmUrl);
  } finally {
    delete g.window;
  }
})();

self.onmessage = async ({ data: job }: MessageEvent<FontJob>) => {
  try {
    await ready;
    const result = job.op === "inspect" ? inspectFont(job.bytes) : convertFont(job.bytes, job.opts);
    postMessage({ ok: true, result });
  } catch (e) {
    postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
