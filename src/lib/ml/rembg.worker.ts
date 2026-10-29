// ONNX Runtime in its own worker, so neither the model download nor inference
// ever blocks the page. WebGPU when the device has it, multi-threaded wasm otherwise.
import * as ort from "onnxruntime-web";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import { cachedDownload } from "./download";
import type { ModelInfo } from "./rembg";

export type Request = { id: number } & ({ type: "load"; model: ModelInfo } | { type: "run"; input: Float32Array; size: number });

export type Reply =
  | { type: "progress"; phase: "download" | "starting"; loaded: number; total: number }
  | { type: "done"; id: number; result: unknown }
  | { type: "error"; id: number; error: string };

// Our own copies of the runtime (no CDN); threads need cross-origin isolation (SharedArrayBuffer).
ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 1)) : 1;

const post = (msg: Reply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

type Gpu = { requestAdapter(): Promise<{ features: Set<string> } | null> };
/** WebGPU with fp16 shaders (the model is fp16). */
const hasGpu = async () => {
  const adapter = await (navigator as Navigator & { gpu?: Gpu }).gpu?.requestAdapter().catch(() => null);
  return Boolean(adapter?.features.has("shader-f16"));
};

let loaded: Promise<{ session: ort.InferenceSession; backend: string }> | null = null;

function load(model: ModelInfo) {
  loaded ??= (async () => {
    const bytes = await cachedDownload(model.url, (l, total) => post({ type: "progress", phase: "download", loaded: l, total }), model.bytes);
    post({ type: "progress", phase: "starting", loaded: 0, total: 0 });
    const create = (ep: "webgpu" | "wasm") => ort.InferenceSession.create(bytes, {
        executionProviders: [ep],
        graphOptimizationLevel: "all",
        // Errors only: the warnings (unused initializers, shape ops kept on the CPU) are noise.
        logSeverityLevel: 3,
      });
    // The GPU is several times faster; wasm when there's none or it can't take the model.
    if (await hasGpu()) {
      const session = await create("webgpu").catch(() => null);
      if (session) return { session, backend: "WebGPU" };
    }
    return { session: await create("wasm"), backend: `wasm × ${ort.env.wasm.numThreads}` };
  })();
  loaded.catch(() => (loaded = null));
  return loaded;
}

// One job at a time: a session can't run twice at once, and the load must finish before runs.
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = ({ data: req }: MessageEvent<Request>) => {
  chain = chain
    .then(async () => {
      if (req.type === "load") {
        post({ type: "done", id: req.id, result: (await load(req.model)).backend });
        return;
      }
      if (!loaded) throw new Error("The model isn't loaded");
      const { session } = await loaded;
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", req.input, [1, 3, req.size, req.size]) });
      const tensor = out[session.outputNames[0]];
      const mask = (tensor.data as Float32Array).slice();
      tensor.dispose();
      post({ type: "done", id: req.id, result: mask }, [mask.buffer]);
    })
    .catch((e: unknown) => post({ type: "error", id: req.id, error: e instanceof Error ? e.message : String(e) }));
};
