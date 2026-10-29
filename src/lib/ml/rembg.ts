// Background removal maths that needs no browser: the model, image → tensor,
// network output → alpha mask, and edge refinement. Unit-tested in Node.
import model from "./model.json";

export interface ModelInfo {
  url: string;
  /** Download size, shown before the first use and used when the server sends no length. */
  bytes: number;
  /** Square input side the network expects. */
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
}

/**
 * ISNet general-use (DIS weights, Apache-2.0; rembg's ONNX export) in fp16, 88 MB. Served from
 * our own origin: scripts/fetch-model.mjs downloads the pinned file (model.json, SHA-256 checked)
 * into public/models/ before dev and build. Runs on WebGPU or multi-threaded wasm.
 * Rejected: the dynamic-int8 build of the same export (half the size, speckled masks) and
 * BiRefNet lite fp16 (MIT; fails on ORT 1.31's WebGPU kernels and runs out of memory on wasm).
 */
export const MODEL: ModelInfo = {
  url: `/models/${model.file}`,
  bytes: model.bytes,
  size: 1024,
  mean: [0.5, 0.5, 0.5],
  std: [1, 1, 1],
};

/** RGBA pixels (already resized to size×size) → normalised planar RGB float tensor [1,3,size,size]. */
export function toTensor(rgba: Uint8ClampedArray | Uint8Array, size: number, mean: number[], std: number[]): Float32Array {
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let c = 0; c < 3; c++) {
    const m = mean[c];
    const s = std[c];
    const plane = c * n;
    for (let i = 0; i < n; i++) out[plane + i] = (rgba[i * 4 + c] / 255 - m) / s;
  }
  return out;
}

/** Network probability map → 8-bit alpha (0 = background, 255 = subject), min-max stretched like rembg. */
export function maskToAlpha(out: Float32Array): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(out.length);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // A flat map (nothing found) stays empty instead of stretching noise into a mask.
  if (hi - lo < 1e-6) return alpha;
  const k = 255 / (hi - lo);
  for (let i = 0; i < out.length; i++) alpha[i] = (out[i] - lo) * k;
  return alpha;
}

export interface Refine {
  /** Steeper alpha ramp: drops faint halos and firms up soft edges. */
  sharpen: boolean;
  /** Box-blur radius in mask pixels; softens the cut line. */
  feather: number;
}

/** Edge refinement on the model-sized mask (cheap, before it's scaled up to the photo). */
export function refineMask(alpha: Uint8ClampedArray, width: number, height: number, o: Refine): Uint8ClampedArray {
  let out = alpha;
  if (o.sharpen) {
    out = new Uint8ClampedArray(alpha.length);
    for (let i = 0; i < alpha.length; i++) out[i] = (alpha[i] - 128) * 3 + 128;
  }
  const r = Math.round(o.feather);
  return r > 0 ? boxBlur(out, width, height, r) : out;
}

/** Separable box blur with clamped edges, O(pixels) whatever the radius. */
export function boxBlur(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const d = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + clampX(k)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / d;
      sum += src[row + clampX(x + r + 1)] - src[row + clampX(x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clampY(k) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / d;
      sum += tmp[clampY(y + r + 1) * w + x] - tmp[clampY(y - r) * w + x];
    }
  }
  return out;
}
