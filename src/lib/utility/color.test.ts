import { describe, expect, it } from "vitest";
import { BLACK, NAMED_COLORS, WHITE, contrast, formatAll, nearestNamed, parseColor, toHex, toLab, toOklch, wcag, type RGBA } from "./color";

const rgb = (s: string) => {
  const c = parseColor(s);
  if (!c) throw new Error(`unparsed ${s}`);
  return [Math.round(c.r), Math.round(c.g), Math.round(c.b), Number(c.a.toFixed(3))];
};
const ORANGE: RGBA = { r: 255, g: 107, b: 44, a: 1 };

describe("parseColor", () => {
  it("reads every hex length", () => {
    expect(rgb("#ff6b2c")).toEqual([255, 107, 44, 1]);
    expect(rgb("FF6B2C")).toEqual([255, 107, 44, 1]);
    expect(rgb("#f62")).toEqual([255, 102, 34, 1]);
    expect(rgb("#f628")).toEqual([255, 102, 34, 0.533]);
    expect(rgb("#ff6b2c80")).toEqual([255, 107, 44, 0.502]);
    expect(parseColor("#ff6b2")).toBeNull();
    expect(parseColor("#gg0000")).toBeNull();
  });

  it("reads rgb() in legacy, modern and percent syntax", () => {
    expect(rgb("rgb(255, 107, 44)")).toEqual([255, 107, 44, 1]);
    expect(rgb("rgba(255,107,44,0.5)")).toEqual([255, 107, 44, 0.5]);
    expect(rgb("rgb(255 107 44 / 25%)")).toEqual([255, 107, 44, 0.25]);
    expect(rgb("rgb(100% 0% 50%)")).toEqual([255, 0, 128, 1]);
    expect(rgb("255, 107, 44")).toEqual([255, 107, 44, 1]);
    expect(parseColor("rgb(255, 107)")).toBeNull();
  });

  it("reads hsl, hsv/hsb, hwb and cmyk", () => {
    expect(rgb("hsl(17.9, 100%, 58.6%)")).toEqual([255, 107, 44, 1]);
    expect(rgb("hsl(120deg 100% 25%)")).toEqual([0, 128, 0, 1]);
    expect(rgb("hsl(0.5turn 100% 50%)")).toEqual([0, 255, 255, 1]);
    expect(rgb("hsla(240, 100%, 50%, .3)")).toEqual([0, 0, 255, 0.3]);
    expect(rgb("hsv(17.9, 82.7%, 100%)")).toEqual([255, 107, 44, 1]);
    expect(rgb("hsb(0, 0, 50)")).toEqual([128, 128, 128, 1]);
    expect(rgb("hwb(17.9 17.3% 0%)")).toEqual([255, 107, 44, 1]);
    expect(rgb("hwb(0 60% 60%)")).toEqual([128, 128, 128, 1]);
    expect(rgb("cmyk(0%, 58%, 82.7%, 0%)")).toEqual([255, 107, 44, 1]);
    expect(rgb("cmyk(0, 58, 83, 0)")).toEqual([255, 107, 43, 1]);
    expect(rgb("device-cmyk(0 1 1 0)")).toEqual([255, 0, 0, 1]);
  });

  it("reads lab, lch, oklab and oklch", () => {
    expect(rgb("lab(54.29 80.8 69.89)")).toEqual([255, 0, 0, 1]);
    expect(rgb("lch(54.29% 106.84 40.86)")).toEqual([255, 0, 0, 1]);
    expect(rgb("oklab(0.628 0.2249 0.1258)")).toEqual([255, 0, 0, 1]);
    expect(rgb("oklch(62.8% 0.2577 29.23)")).toEqual([255, 0, 0, 1]);
    expect(rgb("oklch(1 0 0)")).toEqual([255, 255, 255, 1]);
    expect(parseColor("oklch(0.9 0.4 150)")?.clipped).toBe(true);
    expect(parseColor("oklch(0.7 0.1 150)")?.clipped).toBe(false);
  });

  it("reads CSS named colours", () => {
    expect(Object.keys(NAMED_COLORS)).toHaveLength(148);
    expect(rgb("rebeccapurple")).toEqual([102, 51, 153, 1]);
    expect(rgb("Tomato")).toEqual([255, 99, 71, 1]);
    expect(rgb("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseColor("notacolor")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats #ff6b2c in every notation", () => {
    expect(formatAll(ORANGE)).toEqual({
      hex: "#ff6b2c",
      rgb: "rgb(255, 107, 44)",
      hsl: "hsl(17.9, 100%, 58.6%)",
      hsv: "hsv(17.9, 82.7%, 100%)",
      hwb: "hwb(17.9 17.3% 0%)",
      cmyk: "cmyk(0%, 58%, 82.7%, 0%)",
      lab: "lab(64.11 55.38 61.62)",
      lch: "lch(64.11 82.85 48.06)",
      oklab: "oklab(0.7038 0.1471 0.1275)",
      oklch: "oklch(70.38% 0.1946 40.92)",
    });
  });

  it("switches to modern syntax and alpha forms", () => {
    const half = { ...ORANGE, a: 0.5 };
    expect(formatAll(half).rgb).toBe("rgba(255, 107, 44, 0.5)");
    expect(formatAll(half).hsl).toBe("hsla(17.9, 100%, 58.6%, 0.5)");
    expect(formatAll(half, "modern").rgb).toBe("rgb(255 107 44 / 0.5)");
    expect(toHex(half)).toBe("#ff6b2c80");
    expect(toHex(ORANGE, true)).toBe("#FF6B2C");
  });

  it("matches CSS reference values for red", () => {
    const red = parseColor("red")!;
    const [L, a, b] = toLab(red);
    expect(L).toBeCloseTo(54.29, 2);
    expect(a).toBeCloseTo(80.8, 1);
    expect(b).toBeCloseTo(69.89, 2);
    const [oL, oC, oH] = toOklch(red);
    expect(oL).toBeCloseTo(0.628, 3);
    expect(oC).toBeCloseTo(0.2577, 3);
    expect(oH).toBeCloseTo(29.23, 1);
  });

  it("wraps hue 359.97 to 0", () => {
    expect(formatAll(parseColor("oklch(62.8% 0.2577 29.23)")!).hsl).toBe("hsl(0, 100%, 50%)");
  });

  it("finds the nearest named colour", () => {
    expect(nearestNamed(ORANGE)).toEqual({ name: "tomato", exact: false });
    expect(nearestNamed(parseColor("#663399")!)).toEqual({ name: "rebeccapurple", exact: true });
  });
});

describe("WCAG contrast", () => {
  it("computes ratios", () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrast(ORANGE, WHITE)).toBeCloseTo(2.84, 2);
    expect(contrast(ORANGE, BLACK)).toBeCloseTo(7.39, 2);
    expect(contrast(parseColor("#767676")!, WHITE)).toBeCloseTo(4.54, 2);
  });

  it("composites translucent colours over the background", () => {
    expect(contrast({ ...BLACK, a: 0 }, WHITE)).toBeCloseTo(1, 5);
  });

  it("grades AA/AAA", () => {
    expect(wcag(4.54)).toEqual({ aa: true, aaLarge: true, aaa: false, aaaLarge: true });
    expect(wcag(2.84)).toEqual({ aa: false, aaLarge: false, aaa: false, aaaLarge: false });
    expect(wcag(7.39)).toEqual({ aa: true, aaLarge: true, aaa: true, aaaLarge: true });
  });
});
