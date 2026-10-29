import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, degrees } from "pdf-lib";
import { addTextLayers, defaultLangs, ocrScale, textLayerPlacement, toPgm, workerCount, OCR_MAX_PIXELS, OCR_LANGS, langDataUrl } from "./ocr";
import tessdata from "./tessdata.json";

/** Applies a pdf-lib drawPage placement (translate, rotate CCW, scale) to a point of the embedded page. */
function apply(p: ReturnType<typeof textLayerPlacement>, u: number, v: number) {
  const a = (p.rotate * Math.PI) / 180;
  const x = u * p.xScale;
  const y = v * p.yScale;
  return [Math.round(p.x + x * Math.cos(a) - y * Math.sin(a)), Math.round(p.y + x * Math.sin(a) + y * Math.cos(a))];
}

describe("textLayerPlacement", () => {
  // A 600×800 pt page whose visible box starts at (10, 20).
  const box = { x: 10, y: 20, width: 600, height: 800 };

  it("unrotated: scales the text page onto the box", () => {
    const p = textLayerPlacement(box, 0, 2500, 3333.33);
    expect(p.rotate).toBe(0);
    expect(apply(p, 0, 0)).toEqual([10, 20]);
    expect(apply(p, 2500, 3333.33)).toEqual([610, 820]);
  });

  it.each([
    // /Rotate turns the page clockwise for the reader; the text page (made from what the reader sees)
    // must land with its corners on the matching user-space corners.
    [90, { bl: [610, 20], tl: [10, 20], br: [610, 820] }],
    [180, { bl: [610, 820], tl: [610, 20], br: [10, 820] }],
    [270, { bl: [10, 820], tl: [610, 820], br: [10, 20] }],
    [-90, { bl: [10, 820], tl: [610, 820], br: [10, 20] }],
  ] as const)("rotation %i maps the reader's corners to the right page corners", (rot, c) => {
    // Seen rotated by 90/270 the page is 800 wide and 600 tall.
    const [vw, vh] = Math.abs(rot) % 180 ? [800, 600] : [600, 800];
    const p = textLayerPlacement(box, rot, vw * 2, vh * 2);
    expect(p.xScale).toBeCloseTo(0.5);
    expect(p.yScale).toBeCloseTo(0.5);
    expect(apply(p, 0, 0)).toEqual(c.bl);
    expect(apply(p, 0, vh * 2)).toEqual(c.tl);
    expect(apply(p, vw * 2, 0)).toEqual(c.br);
  });
});

describe("addTextLayers", () => {
  it("draws each layer onto its page and leaves the others alone", async () => {
    const src = await PDFDocument.create();
    src.addPage([600, 800]);
    src.addPage([600, 800]).setRotation(degrees(90));
    const layer = await PDFDocument.create();
    layer.addPage([200, 150]).drawText("hello");
    const out = await PDFDocument.load(await addTextLayers(await src.save(), new Map([[1, await layer.save()]])));
    expect(out.getPageCount()).toBe(2);
    const xobjects = (i: number) => out.getPage(i).node.Resources()?.get(PDFName.of("XObject"));
    expect(xobjects(0)).toBeUndefined();
    expect(xobjects(1)).toBeDefined();
    expect(out.getPage(1).getRotation().angle).toBe(90);
  });
});

describe("toPgm", () => {
  it("writes a P5 header and luminance, compositing transparency on white", () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 128]);
    const pgm = toPgm(rgba, 2, 2);
    const header = "P5\n2 2\n255\n";
    expect(new TextDecoder().decode(pgm.slice(0, header.length))).toBe(header);
    expect([...pgm.slice(header.length)]).toEqual([0, 255, 255, 127]);
  });
});

describe("sizing", () => {
  it("renders PDF pages at 300 dpi but caps huge ones", () => {
    expect(ocrScale(595, 842, "pdf")).toBeCloseTo(300 / 72);
    const k = ocrScale(2384, 3370, "pdf"); // A0
    expect(2384 * 3370 * k * k).toBeLessThanOrEqual(OCR_MAX_PIXELS + 1);
  });

  it("doubles small screenshots and keeps normal photos", () => {
    expect(ocrScale(640, 360, "image")).toBe(2);
    expect(ocrScale(1600, 1200, "image")).toBe(1);
    expect(ocrScale(8000, 6000, "image")).toBeLessThan(1);
  });

  it("sizes the worker pool by cores and memory", () => {
    expect(workerCount(16, 8)).toBe(4);
    expect(workerCount(4, 8)).toBe(3);
    expect(workerCount(8, 2)).toBe(1);
    expect(workerCount(8, undefined)).toBe(2);
    expect(workerCount(1, 0.5)).toBe(1);
  });

  it("defaults to English plus the interface language", () => {
    expect(defaultLangs("en")).toEqual(["eng"]);
    expect(defaultLangs("tr")).toEqual(["eng", "tur"]);
    expect(defaultLangs("zh-CN")).toEqual(["eng", "chi_sim"]);
    expect(defaultLangs("xx")).toEqual(["eng"]);
  });
});

describe("language data", () => {
  it("every language in the picker has a pinned file served from our own origin", () => {
    for (const { code } of OCR_LANGS) {
      const file = (tessdata.files as Record<string, { sha256: string; bytes: number }>)[code];
      expect(file, code).toBeTruthy();
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(langDataUrl(code)).toBe(`/${tessdata.dir}/${code}.traineddata.gz`);
    }
    expect(Object.keys(tessdata.files).sort()).toEqual(OCR_LANGS.map((l) => l.code).sort());
  });
});
