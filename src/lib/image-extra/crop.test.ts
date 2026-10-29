import { describe, expect, it } from "vitest";
import { centerCrop, clampMove, cropFor, editField, fitAspect, fromFrac, parseRatio, resizeRect, roundRect, toFrac } from "./crop";

const W = 400;
const H = 300;
const r0 = { x: 100, y: 100, w: 100, h: 50 };

describe("parseRatio", () => {
  it("accepts W:H, WxH, W/H and plain numbers", () => {
    expect(parseRatio("16:9")).toBeCloseTo(16 / 9);
    expect(parseRatio("4x5")).toBe(0.8);
    expect(parseRatio(" 3 / 2 ")).toBe(1.5);
    expect(parseRatio("1.91")).toBe(1.91);
    expect(parseRatio("0:1")).toBeNull();
    expect(parseRatio("abc")).toBeNull();
  });
});

describe("free resize", () => {
  it("moves only the dragged edges", () => {
    expect(resizeRect(r0, "se", 20, 10, null, W, H)).toEqual({ x: 100, y: 100, w: 120, h: 60 });
    expect(resizeRect(r0, "nw", -20, -10, null, W, H)).toEqual({ x: 80, y: 90, w: 120, h: 60 });
    expect(resizeRect(r0, "e", 20, 999, null, W, H)).toEqual({ x: 100, y: 100, w: 120, h: 50 });
    expect(resizeRect(r0, "n", 999, -10, null, W, H)).toEqual({ x: 100, y: 90, w: 100, h: 60 });
  });

  it("stops at the image border and at the minimum size", () => {
    expect(resizeRect(r0, "se", 1000, 1000, null, W, H)).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect(resizeRect(r0, "w", -1000, 0, null, W, H).x).toBe(0);
    expect(resizeRect(r0, "e", -1000, 0, null, W, H, 10).w).toBe(10);
  });
});

describe("locked aspect resize", () => {
  const sq = { x: 100, y: 100, w: 50, h: 50 };

  it("corners keep the ratio and the opposite corner", () => {
    const r = resizeRect(sq, "se", 30, 10, 1, W, H);
    expect(r).toEqual({ x: 100, y: 100, w: 80, h: 80 });
    const nw = resizeRect(sq, "nw", -10, -30, 1, W, H);
    expect(nw).toEqual({ x: 70, y: 70, w: 80, h: 80 });
  });

  it("edges grow around the centre line", () => {
    expect(resizeRect(sq, "e", 20, 0, 1, W, H)).toEqual({ x: 100, y: 90, w: 70, h: 70 });
    expect(resizeRect(sq, "s", 0, 20, 2, W, H)).toEqual({ x: 55, y: 100, w: 140, h: 70 });
  });

  it("is limited by the image on every side", () => {
    const r = resizeRect(sq, "se", 1000, 1000, 1, W, H);
    expect(r).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    const wide = resizeRect({ x: 0, y: 0, w: 160, h: 90 }, "se", 1000, 0, 16 / 9, W, H);
    expect(wide.w).toBe(W);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9);
  });
});

describe("helpers", () => {
  it("clamps moves inside the image", () => {
    expect(clampMove({ x: -10, y: 280, w: 100, h: 50 }, W, H)).toEqual({ x: 0, y: 250, w: 100, h: 50 });
  });

  it("centre crops to an aspect", () => {
    expect(centerCrop(W, H, 1)).toEqual({ x: 50, y: 0, w: 300, h: 300 });
    expect(centerCrop(W, H, 2)).toEqual({ x: 0, y: 50, w: 400, h: 200 });
    expect(centerCrop(W, H, null)).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(fitAspect({ x: 10, y: 10, w: 100, h: 50 }, 1)).toEqual({ x: 35, y: 10, w: 50, h: 50 });
  });

  it("converts to fractions and whole pixels", () => {
    expect(fromFrac(toFrac(r0, W, H), W, H)).toEqual(r0);
    expect(roundRect({ x: 10.4, y: -3, w: 1000, h: 0.2 }, W, H)).toEqual({ x: 10, y: 0, w: 390, h: 1 });
  });
});

describe("batch", () => {
  const shared = { x: 0.25, y: 0, w: 0.5, h: 1 };

  it("same region maps proportionally and re-fits a locked aspect", () => {
    expect(cropFor("same", shared, undefined, null, 800, 600)).toEqual({ x: 200, y: 0, w: 400, h: 600 });
    const r = cropFor("same", shared, undefined, 1, 800, 400);
    expect(r).toEqual({ x: 200, y: 0, w: 400, h: 400 });
    const tall = cropFor("same", shared, undefined, 1, 400, 800);
    expect(tall.w / tall.h).toBeCloseTo(1);
    expect(tall).toEqual({ x: 100, y: 300, w: 200, h: 200 });
  });

  it("centre mode crops each image unless adjusted", () => {
    expect(cropFor("center", shared, undefined, 1, 800, 600)).toEqual({ x: 100, y: 0, w: 600, h: 600 });
    expect(cropFor("center", shared, { x: 0, y: 0, w: 0.5, h: 0.5 }, 1, 800, 600)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});

describe("numeric fields", () => {
  it("keeps the aspect when editing width or height", () => {
    expect(editField({ x: 0, y: 0, w: 100, h: 100 }, "w", 200, 1, W, H)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(editField({ x: 0, y: 0, w: 160, h: 90 }, "h", 180, 16 / 9, W, H)).toEqual({ x: 0, y: 0, w: 320, h: 180 });
  });

  it("shrinks oversize values to fit", () => {
    expect(editField({ x: 100, y: 0, w: 100, h: 100 }, "w", 999, null, W, H)).toEqual({ x: 100, y: 0, w: 300, h: 100 });
    const r = editField({ x: 100, y: 0, w: 100, h: 100 }, "w", 999, 1, W, H);
    expect(r.w).toBeCloseTo(300);
    expect(r.h).toBeCloseTo(300);
    // a typed position wins; the box shrinks to fit
    expect(editField({ x: 0, y: 0, w: 100, h: 100 }, "x", 350, null, W, H)).toEqual({ x: 350, y: 0, w: 50, h: 100 });
    expect(editField({ x: 0, y: 0, w: 100, h: 100 }, "y", 250, 1, W, H)).toEqual({ x: 0, y: 250, w: 50, h: 50 });
    expect(editField({ x: 0, y: 0, w: 100, h: 100 }, "x", -5, null, W, H).x).toBe(0);
  });
});
