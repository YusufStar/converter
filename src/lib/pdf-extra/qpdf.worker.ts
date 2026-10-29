// Runs qpdf off the main thread. The module instance is created as soon as the
// worker starts (warm-up) and reused for every job this worker gets.
import glue from "@neslinesli93/qpdf-wasm/dist/qpdf.js?raw";
import wasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { createQpdf, type Qpdf, type QpdfFactory } from "./qpdf";

// The glue is CommonJS; evaluate it with a module shim rather than pre-bundling it.
function factory(): QpdfFactory {
  const module = { exports: {} as unknown };
  new Function("module", "exports", glue)(module, module.exports);
  return module.exports as QpdfFactory;
}

let engine: Promise<Qpdf> | null = null;
const load = () =>
  (engine ??= createQpdf(factory(), new URL(wasmUrl, self.location.href).href).catch((e) => {
    engine = null;
    throw e;
  }));
void load().catch(() => {});

self.onmessage = async (e: MessageEvent<{ args: string[]; input?: Uint8Array }>) => {
  try {
    const result = (await load()).run(e.data.args, e.data.input);
    if (result.crashed) engine = null;
    self.postMessage(result, result.file ? [result.file.buffer] : []);
  } catch (err) {
    self.postMessage({ code: -1, output: `qpdf couldn't start (${err instanceof Error ? err.message : err})`, crashed: true });
  }
};
