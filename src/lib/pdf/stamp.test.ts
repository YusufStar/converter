import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees } from "pdf-lib";
import { addPageNumbers, addWatermark, formatNumber, spotPosition, toUserSpace, visualSize, watermarkAnchors, type Box } from "./stamp";

const dejavu = async () => new Uint8Array(await readFile(new URL("../../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", import.meta.url)));

async function makePdf(sizes: [number, number][], rotate = 0) {
  const doc = await PDFDocument.create();
  for (const s of sizes) doc.addPage(s).setRotation(degrees(rotate));
  return doc.save();
}

/** Decoded content streams of every page, as text. */
async function pageContents(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    return refs
      .map((r) => {
        const s = doc.context.lookup(r);
        return s instanceof PDFRawStream ? new TextDecoder("latin1").decode(decodePDFRawStream(s).decode()) : "";
      })
      .join("\n");
  });
}

/** pdf-lib writes Helvetica text as a hex string of its WinAnsi bytes. */
const hex = (s: string) => `<${[...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join("")}>`;

describe("placement math", () => {
  const box: Box = { x: 10, y: 20, width: 100, height: 200 };

  it("visual size swaps sides for 90/270", () => {
    expect(visualSize(box, 0)).toEqual({ width: 100, height: 200 });
    expect(visualSize(box, 90)).toEqual({ width: 200, height: 100 });
    expect(visualSize(box, -90)).toEqual({ width: 200, height: 100 });
    expect(visualSize(box, 180)).toEqual({ width: 100, height: 200 });
  });

  it("maps the displayed bottom-left corner to the right user-space corner", () => {
    // /Rotate turns the page clockwise for display.
    expect(toUserSpace(0, 0, box, 0)).toEqual({ x: 10, y: 20 });
    expect(toUserSpace(0, 0, box, 90)).toEqual({ x: 110, y: 20 }); // bottom-right corner
    expect(toUserSpace(0, 0, box, 180)).toEqual({ x: 110, y: 220 }); // top-right
    expect(toUserSpace(0, 0, box, 270)).toEqual({ x: 10, y: 220 }); // top-left
  });

  it("maps the displayed top-right corner too", () => {
    for (const r of [0, 90, 180, 270]) {
      const v = visualSize(box, r);
      const corner = toUserSpace(v.width, v.height, box, r);
      const opposite = toUserSpace(0, 0, box, r);
      // Opposite corners of the crop box, whatever the rotation.
      expect([Math.abs(corner.x - opposite.x), Math.abs(corner.y - opposite.y)]).toEqual([100, 200]);
    }
  });

  it("places the six spots inside the margins", () => {
    const at = (spot: Parameters<typeof spotPosition>[0]) => spotPosition(spot, 600, 800, 40, 10, 30);
    expect(at("tl")).toEqual({ x: 30, y: 760 });
    expect(at("tc")).toEqual({ x: 280, y: 760 });
    expect(at("tr")).toEqual({ x: 530, y: 760 });
    expect(at("bl")).toEqual({ x: 30, y: 30 });
    expect(at("bc")).toEqual({ x: 280, y: 30 });
    expect(at("br")).toEqual({ x: 530, y: 30 });
  });

  it("formats number templates", () => {
    expect(formatNumber("Page {n} of {total}", 3, 12)).toBe("Page 3 of 12");
    expect(formatNumber("{n} / {total}", 1, 1)).toBe("1 / 1");
  });

  it("centres a rotated watermark on the page", () => {
    const [w, h, a] = [200, 40, 45];
    const [p] = watermarkAnchors(600, 800, w, h, a, "center");
    const r = (a * Math.PI) / 180;
    const cx = p.x + (Math.cos(r) * w) / 2 - (Math.sin(r) * h) / 2;
    const cy = p.y + (Math.sin(r) * w) / 2 + (Math.cos(r) * h) / 2;
    expect(cx).toBeCloseTo(300);
    expect(cy).toBeCloseTo(400);
  });

  it("tiles the whole page", () => {
    const anchors = watermarkAnchors(600, 800, 150, 30, 30, "tile");
    expect(anchors.length).toBeGreaterThan(8);
    expect(anchors.length).toBeLessThan(200);
    // Some copy reaches into each quadrant.
    const quads = new Set(anchors.map((p) => `${p.x > 300 ? 1 : 0}${p.y > 400 ? 1 : 0}`));
    expect(quads.size).toBe(4);
  });
});

describe("addPageNumbers", () => {
  const base = { spot: "bc" as const, start: 1, size: 12, margin: 24, color: "#000000", skipFirst: false };

  it("stamps 'Page n of N' on every page", async () => {
    const out = await addPageNumbers(await makePdf([[300, 400], [300, 400], [300, 400]]), { ...base, template: "Page {n} of {total}" });
    const pages = await pageContents(out);
    expect(pages[0]).toContain(hex("Page 1 of 3"));
    expect(pages[2]).toContain(hex("Page 3 of 3"));
  });

  it("skips the cover and counts from the start number", async () => {
    const out = await addPageNumbers(await makePdf([[300, 400], [300, 400], [300, 400]]), { ...base, template: "{n} / {total}", start: 5, skipFirst: true });
    const pages = await pageContents(out);
    expect(pages[0]).not.toContain("Tj");
    expect(pages[1]).toContain(hex("5 / 6"));
    expect(pages[2]).toContain(hex("6 / 6"));
  });

  it("works on rotated pages", async () => {
    const out = await addPageNumbers(await makePdf([[300, 400]], 90), { ...base, template: "{n}" });
    expect((await pageContents(out))[0]).toContain(hex("1"));
  });
});

describe("addWatermark", () => {
  const base = { size: 48, opacity: 0.3, angle: 45, color: "#ff0000", mode: "center" as const, pages: "" };

  it("draws semi-transparent text on the selected pages", async () => {
    const out = await addWatermark(await makePdf([[600, 800], [600, 800]]), { ...base, text: "DRAFT", pages: "2" }, dejavu);
    const pages = await pageContents(out);
    expect(pages[0]).not.toContain(hex("DRAFT"));
    expect(pages[1]).toContain(hex("DRAFT"));
    const doc = await PDFDocument.load(out);
    const gs = doc.getPage(1).node.Resources()!.lookup(PDFName.of("ExtGState"), PDFDict);
    expect(gs.values().map((ref) => String(doc.context.lookup(ref, PDFDict).get(PDFName.of("ca"))))).toContain("0.3");
  });

  it("tiles many copies", async () => {
    const out = await addWatermark(await makePdf([[600, 800]]), { ...base, text: "COPY", mode: "tile" }, dejavu);
    expect((await pageContents(out))[0].split(hex("COPY")).length - 1).toBeGreaterThan(8);
  });

  it("embeds a Unicode font for Turkish text", async () => {
    let loaded = false;
    const out = await addWatermark(await makePdf([[600, 800]]), { ...base, text: "GİZLİ ğüşıöç" }, async () => {
      loaded = true;
      return dejavu();
    });
    expect(loaded).toBe(true);
    const doc = await PDFDocument.load(out);
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const names = fonts.values().map((ref) => String(doc.context.lookup(ref, PDFDict).get(PDFName.of("BaseFont"))));
    expect(names.some((n) => n.includes("DejaVuSans"))).toBe(true);
  });

  it("needs text", async () => {
    await expect(addWatermark(await makePdf([[100, 100]]), { ...base, text: "  " }, dejavu)).rejects.toThrow("Enter the watermark text");
  });
});
