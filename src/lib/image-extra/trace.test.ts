import ImageTracer from "imagetracerjs";
import { describe, expect, it } from "vitest";
import { PRESETS, buildSvg, edgeColor, hexColor, nearestColor, seedPalette, traceImage, traceSize, tracerOptions, type Pixels, type TraceSettings } from "./trace";

/** w×h image: white background, a red square and a blue square with a white hole. */
function shapes(w = 60, h = 40): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const red = x >= 5 && x < 25 && y >= 10 && y < 30;
      const blue = x >= 35 && x < 55 && y >= 10 && y < 30 && !(x >= 42 && x < 48 && y >= 17 && y < 23);
      data.set(red ? [255, 0, 0, 255] : blue ? [0, 0, 255, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

const settings = (preset: TraceSettings["preset"], over: Partial<TraceSettings> = {}): TraceSettings => ({ preset, size: 1000, ...PRESETS[preset], ...over });

describe("options", () => {
  it("maps settings onto imagetracer options with clamping", () => {
    const o = tracerOptions(settings("posterized", { colors: 99, blur: 9, omit: -3 }));
    expect(o).toMatchObject({ numberofcolors: 64, blurradius: 5, pathomit: 0, ltres: 1, qtres: 1 });
    expect(tracerOptions(settings("lineart"))).toMatchObject({ colorsampling: 0, colorquantcycles: 1, numberofcolors: 2 });
    expect(tracerOptions(settings("smooth")).linefilter).toBe(true);
  });

  it("caps the trace size by the long side and by memory", () => {
    expect(traceSize(4000, 3000, { size: 1000, colors: 2 })).toEqual({ width: 1000, height: 750 });
    expect(traceSize(400, 300, { size: 1000, colors: 16 })).toEqual({ width: 400, height: 300 });
    const big = traceSize(4000, 4000, { size: 4000, colors: 64 });
    expect(big.width * big.height * 64).toBeLessThanOrEqual(24e6 * 1.01);
  });
});

describe("colours", () => {
  it("finds the dominant border colour", () => {
    expect(edgeColor(shapes())).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    const t = { width: 2, height: 2, data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9, 9, 255]) };
    expect(edgeColor(t).a).toBe(0);
  });

  it("matches the nearest palette entry and writes short hex", () => {
    const pal = [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 250, g: 250, b: 250, a: 255 },
    ];
    expect(nearestColor(pal, { r: 255, g: 255, b: 255, a: 255 })).toBe(1);
    expect(hexColor({ r: 255, g: 0, b: 0, a: 255 })).toBe("#f00");
    expect(hexColor({ r: 18, g: 52, b: 86, a: 255 })).toBe("#123456");
  });
});

describe("svg writer", () => {
  it("writes one path per layer with holes reversed, skipping transparent and skipped layers", () => {
    const td = {
      width: 10,
      height: 10,
      palette: [
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 0, b: 0, a: 0 },
        { r: 0, g: 0, b: 255, a: 128 },
      ],
      layers: [
        [
          {
            isholepath: false,
            holechildren: [1],
            segments: [
              { type: "L" as const, x1: 0, y1: 0, x2: 10, y2: 0 },
              { type: "L" as const, x1: 10, y1: 0, x2: 10, y2: 10 },
              { type: "Q" as const, x1: 10, y1: 10, x2: 5, y2: 12.34, x3: 0, y3: 10 },
            ],
          },
          {
            isholepath: true,
            holechildren: [],
            segments: [
              { type: "L" as const, x1: 2, y1: 2, x2: 4, y2: 2 },
              { type: "L" as const, x1: 4, y1: 2, x2: 2, y2: 4 },
            ],
          },
        ],
        [{ isholepath: false, holechildren: [], segments: [{ type: "L" as const, x1: 0, y1: 0, x2: 1, y2: 1 }] }],
        [{ isholepath: false, holechildren: [], segments: [{ type: "L" as const, x1: 0, y1: 0, x2: 1, y2: 1 }] }],
      ],
    };
    const { svg, paths } = buildSvg(td, { width: 100, height: 100 });
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 10 10">' +
        '<path fill="#f00" stroke="#f00" d="M0 0L10 0L10 10Q5 12.3 0 10ZM2 4L4 2L2 2Z"/>' +
        '<path fill="#00f" stroke="#00f" opacity="0.502" d="M0 0L1 1Z"/></svg>',
    );
    expect(paths).toBe(2);
    expect(buildSvg(td, { width: 1, height: 1, skip: new Set([0]) }).paths).toBe(1);
  });
});

describe("tracing", () => {
  it("vectorises shapes with exact colours and the original size", () => {
    const { svg, paths } = traceImage(ImageTracer, { image: shapes(), settings: settings("posterized", { colors: 3, blur: 0, omit: 0 }), width: 600, height: 400 });
    expect(svg).toMatch(/^<svg [^>]*width="600" height="400" viewBox="0 0 60 40">/);
    expect(svg).toContain('fill="#f00"');
    expect(svg).toContain('fill="#00f"');
    expect(svg).toContain('fill="#fff"');
    expect(paths).toBeGreaterThanOrEqual(3);
  });

  it("removes the background colour", () => {
    const { svg } = traceImage(ImageTracer, { image: shapes(), settings: settings("posterized", { colors: 3, blur: 0, omit: 0, removeBg: true }), width: 60, height: 40 });
    expect(svg).not.toContain('fill="#fff"');
    expect(svg).toContain('fill="#f00"');
  });

  it("line art is pure black on transparent", () => {
    const { svg } = traceImage(ImageTracer, { image: shapes(), settings: settings("lineart"), width: 60, height: 40 });
    expect(svg).toContain('fill="#000"');
    expect(svg).not.toContain('fill="#fff"');
  });

  it("every preset produces a valid SVG", () => {
    for (const preset of Object.keys(PRESETS) as TraceSettings["preset"][]) {
      const { svg } = traceImage(ImageTracer, { image: shapes(), settings: settings(preset), width: 60, height: 40 });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain("<path");
    }
  });
});

describe("palette seeding", () => {
  it("picks every distinct colour, most common first", () => {
    expect(seedPalette(shapes(), 3)).toEqual([
      { r: 255, g: 255, b: 255, a: 255 },
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 },
    ]);
    expect(seedPalette(shapes(), 16)).toHaveLength(3);
  });
});
