export type ResizeMode = "original" | "percent" | "dimensions" | "longest";

export interface ResizeOptions {
  mode: ResizeMode;
  /** For "percent": 100 = original, 200 = 2×. */
  percent: number;
  /** For "dimensions": either may be null (= derive from the other). */
  width: number | null;
  height: number | null;
  /** For "dimensions": keep aspect ratio (fit inside the box) or stretch to it. */
  keepAspect: boolean;
  /** For "longest": length of the longest side in px. */
  longest: number;
  /** Never upscale raster images (SVG is vector, so it always may). */
  noEnlarge: boolean;
}

export const DEFAULT_RESIZE: ResizeOptions = {
  mode: "original",
  percent: 100,
  width: null,
  height: null,
  keepAspect: true,
  longest: 1920,
  noEnlarge: false,
};

export const MAX_SIDE = 16384;
// Browsers cap canvas area (Chrome ~268M px, Safari lower); stay well under.
export const MAX_AREA = 120_000_000;

export interface Size {
  width: number;
  height: number;
}

/** Target pixel size for a source of `src` size. Always ≥1 and within canvas limits. */
export function targetSize(src: Size, o: ResizeOptions, vector = false): Size {
  let w = src.width;
  let h = src.height;
  const ratio = src.width / src.height;

  switch (o.mode) {
    case "percent": {
      const f = Math.max(0.01, o.percent / 100);
      w = src.width * f;
      h = src.height * f;
      break;
    }
    case "dimensions": {
      const W = o.width && o.width > 0 ? o.width : null;
      const H = o.height && o.height > 0 ? o.height : null;
      if (o.keepAspect) {
        if (W && H) {
          const f = Math.min(W / src.width, H / src.height);
          w = src.width * f;
          h = src.height * f;
        } else if (W) {
          w = W;
          h = W / ratio;
        } else if (H) {
          h = H;
          w = H * ratio;
        }
      } else {
        w = W ?? src.width;
        h = H ?? src.height;
      }
      break;
    }
    case "longest": {
      const f = o.longest > 0 ? o.longest / Math.max(src.width, src.height) : 1;
      w = src.width * f;
      h = src.height * f;
      break;
    }
    case "original":
      break;
  }

  if (o.noEnlarge && !vector && (w > src.width || h > src.height)) {
    const f = Math.min(src.width / w, src.height / h);
    w *= f;
    h *= f;
  }

  // Clamp to canvas limits, keeping the aspect ratio we arrived at.
  const side = Math.max(w, h);
  if (side > MAX_SIDE) {
    w *= MAX_SIDE / side;
    h *= MAX_SIDE / side;
  }
  if (w * h > MAX_AREA) {
    const f = Math.sqrt(MAX_AREA / (w * h));
    w *= f;
    h *= f;
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}
