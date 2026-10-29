// Background removal on the main thread side: talks to the ONNX worker, and
// turns the model-sized mask into a full-resolution cut-out with canvas.
import { ctx2d, makeCanvas, type AnyCanvas } from "../image/encode";
import { createStore, isCached } from "./download";
import { MODEL, maskToAlpha, refineMask, toTensor, type Refine } from "./rembg";
import type { Reply, Request } from "./rembg.worker";

export interface ModelStatus {
  phase: "idle" | "download" | "starting" | "ready" | "error";
  loaded: number;
  total: number;
  /** "WebGPU" or "wasm × N" once ready. */
  backend?: string;
  error?: string;
}

export const modelStatus = createStore<ModelStatus>({ phase: "idle", loaded: 0, total: 0 });

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Call = DistOmit<Request, "id">;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let loading: Promise<string> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Ends the worker and fails whatever it was doing; the next call starts a fresh one (model from cache). */
function stop(err: Error) {
  pending.forEach((p) => p.reject(err));
  pending.clear();
  worker?.terminate();
  worker = null;
  loading = null;
}

function spawn(): Worker {
  const w = new Worker(new URL("./rembg.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = ({ data }: MessageEvent<Reply>) => {
    if (data.type === "progress") {
      modelStatus.set({ phase: data.phase, loaded: data.loaded, total: data.total });
      return;
    }
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.type === "error") p?.reject(new Error(data.error));
    else p?.resolve(data.result);
  };
  // A crash (usually out of memory) fails everything in flight.
  w.onerror = (e) => {
    e.preventDefault();
    const err = new Error("The background remover stopped (the device may be out of memory)");
    stop(err);
    modelStatus.set({ phase: "error", loaded: 0, total: 0, error: err.message });
  };
  return w;
}

function call<T>(msg: Call, transfer: Transferable[] = []): Promise<T> {
  clearTimeout(idleTimer);
  worker ??= spawn();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ ...msg, id }, transfer);
  });
}

/** Downloads (first time) and starts the model; one shared promise. Resolves to the backend name. */
export function loadModel(): Promise<string> {
  if (loading) return loading;
  modelStatus.set({ phase: "starting", loaded: 0, total: MODEL.bytes });
  const p: Promise<string> = call<string>({ type: "load", model: MODEL }).then(
    (backend) => {
      if (loading === p) modelStatus.set({ phase: "ready", loaded: 0, total: 0, backend });
      return backend;
    },
    (e: Error) => {
      if (loading === p) {
        loading = null;
        modelStatus.set({ phase: "error", loaded: 0, total: 0, error: e.message });
      }
      throw e;
    },
  );
  loading = p;
  return p;
}

export const modelCached = () => isCached(MODEL.url);

/** Warm-up on mount: start the model only if it's already downloaded (no surprise 88 MB download). */
export async function warmModel() {
  if (!loading && (await modelCached())) await loadModel().catch(() => {});
}

/** Called when the screen unmounts: the worker (and the model's memory) goes after a quiet minute. */
export function releaseModel() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size) return;
    stop(new Error("released"));
    modelStatus.set({ phase: "idle", loaded: 0, total: 0 });
  }, 60_000);
}

// Raw masks per input file, so changing edges or background re-renders instantly.
const masks = new WeakMap<File, Uint8ClampedArray>();

/**
 * The model's alpha mask (size×size) for `source`. Cancelling stops the worker
 * outright (inference can't be interrupted otherwise); the model reloads from cache.
 */
export async function subjectMask(file: File, source: CanvasImageSource, signal: AbortSignal): Promise<Uint8ClampedArray> {
  const hit = masks.get(file);
  if (hit) return hit;
  const m = MODEL;
  const onAbort = () => {
    stop(new DOMException("Cancelled", "AbortError"));
    modelStatus.set({ phase: "idle", loaded: 0, total: 0 });
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await loadModel();
    const c = makeCanvas(m.size, m.size);
    const g = ctx2d(c);
    g.imageSmoothingQuality = "high";
    // Stretched to the square input, as the model was trained.
    g.drawImage(source, 0, 0, m.size, m.size);
    const tensor = toTensor(g.getImageData(0, 0, m.size, m.size).data, m.size, m.mean, m.std);
    const alpha = maskToAlpha(await call<Float32Array>({ type: "run", input: tensor, size: m.size }, [tensor.buffer]));
    masks.set(file, alpha);
    return alpha;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export type Backdrop = { kind: "transparent" } | { kind: "color"; color: string } | { kind: "blur"; amount: number } | { kind: "mask" };

/** Biggest output we draw; past this canvases fail on some browsers (Safari: 16.7 MP). */
const MAX_PIXELS = 36e6;

/** Scales the refined mask up to the photo (smoothly) and applies it as alpha, then adds the backdrop. */
export function composite(
  source: CanvasImageSource,
  width: number,
  height: number,
  alpha: Uint8ClampedArray,
  maskSize: number,
  refine: Refine,
  backdrop: Backdrop,
): AnyCanvas {
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
  const W = Math.max(1, Math.round(width * k));
  const H = Math.max(1, Math.round(height * k));
  const refined = refineMask(alpha, maskSize, maskSize, refine);

  const white = backdrop.kind === "mask";
  const maskData = new ImageData(maskSize, maskSize);
  for (let i = 0; i < refined.length; i++) {
    const p = i * 4;
    if (white) maskData.data[p] = maskData.data[p + 1] = maskData.data[p + 2] = 255;
    maskData.data[p + 3] = refined[i];
  }
  const small = makeCanvas(maskSize, maskSize);
  ctx2d(small).putImageData(maskData, 0, 0);

  const out = makeCanvas(W, H);
  const g = ctx2d(out);
  g.imageSmoothingQuality = "high";
  if (white) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    g.drawImage(small, 0, 0, W, H);
    return out;
  }
  // Subject: the photo, kept only where the (smoothly upscaled) mask is.
  const subject = makeCanvas(W, H);
  const s = ctx2d(subject);
  s.imageSmoothingQuality = "high";
  s.drawImage(source, 0, 0, W, H);
  s.globalCompositeOperation = "destination-in";
  s.drawImage(small, 0, 0, W, H);
  if (backdrop.kind === "transparent") return subject;
  if (backdrop.kind === "color") {
    g.fillStyle = backdrop.color;
    g.fillRect(0, 0, W, H);
  } else {
    drawBlurred(g, source, W, H, (backdrop.amount * Math.max(W, H)) / 400);
  }
  g.drawImage(subject, 0, 0);
  subject.width = subject.height = 0;
  return out;
}

function drawBlurred(g: CanvasRenderingContext2D, source: CanvasImageSource, W: number, H: number, radius: number) {
  if (typeof g.filter === "string") {
    // Drawn a radius larger on every side so the blur doesn't fade in from transparent edges.
    g.filter = `blur(${radius}px)`;
    g.drawImage(source, -radius, -radius, W + 2 * radius, H + 2 * radius);
    g.filter = "none";
    return;
  }
  // No canvas filters (older Safari): shrink and stretch back, which smooths about as much.
  const f = Math.max(1, radius / 2);
  const tiny = makeCanvas(Math.max(1, Math.round(W / f)), Math.max(1, Math.round(H / f)));
  const t = ctx2d(tiny);
  t.imageSmoothingQuality = "high";
  t.drawImage(source, 0, 0, tiny.width, tiny.height);
  g.drawImage(tiny, 0, 0, W, H);
}
