import { describe, expect, it } from "vitest";
import { boxBlur, maskToAlpha, refineMask, toTensor } from "./rembg";

describe("toTensor", () => {
  it("normalises RGBA into planar RGB floats", () => {
    // 2×2: red, green, blue, white (alpha ignored).
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255]);
    const t = toTensor(rgba, 2, [0.5, 0.5, 0.5], [1, 1, 1]);
    expect([...t]).toEqual([0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5]);
  });

  it("applies per-channel mean/std (ImageNet)", () => {
    const t = toTensor(new Uint8Array([255, 255, 255, 255]), 1, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(t[2]).toBeCloseTo((1 - 0.406) / 0.225);
  });
});

describe("maskToAlpha", () => {
  it("stretches probabilities to the full range", () => {
    expect([...maskToAlpha(new Float32Array([0.1, 0.3, 0.5]))]).toEqual([0, 128, 255]);
  });

  it("leaves a flat map empty instead of amplifying noise", () => {
    expect([...maskToAlpha(new Float32Array([0.2, 0.2, 0.2]))]).toEqual([0, 0, 0]);
  });
});

describe("refineMask", () => {
  const soft = new Uint8ClampedArray([0, 60, 128, 200, 255]);

  it("returns the mask as is with nothing to do", () => {
    expect(refineMask(soft, 5, 1, { sharpen: false, feather: 0 })).toBe(soft);
  });

  it("sharpen pushes soft edges to the ends", () => {
    expect([...refineMask(soft, 5, 1, { sharpen: true, feather: 0 })]).toEqual([0, 0, 128, 255, 255]);
  });

  it("feather blurs a hard edge into a ramp", () => {
    const edge = new Uint8ClampedArray([0, 0, 0, 255, 255, 255]);
    const out = refineMask(edge, 6, 1, { sharpen: false, feather: 1 });
    expect([...out]).toEqual([0, 0, 85, 170, 255, 255]);
  });
});

describe("boxBlur", () => {
  it("keeps a flat image flat and preserves the mean of a symmetric spot", () => {
    expect([...boxBlur(new Uint8ClampedArray(9).fill(77), 3, 3, 1)]).toEqual(Array(9).fill(77));
    const spot = new Uint8ClampedArray(25);
    spot[12] = 225;
    const out = boxBlur(spot, 5, 5, 1);
    expect(out[12]).toBe(25);
    expect(out[0]).toBe(0);
    expect(out.reduce((a, b) => a + b, 0)).toBe(225);
  });
});
