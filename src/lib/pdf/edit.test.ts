import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFHexString, PDFName, StandardFonts, degrees } from "pdf-lib";
import { ENCRYPTED, loadPdf, mergePdfs, optimizePdf, organizePdf, pdfFromJpegs, readMeta, removePages, rotatePdf, splitPdf, writeMeta } from "./edit";
import { splitPlan } from "./ranges";

/** A PDF whose page i is (100 + 10·i) points wide, so tests can tell pages apart. */
async function makePdf(pages: number, o: { rotate?: number; title?: string } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([100 + 10 * i, 200]);
    page.drawText(`Page ${i + 1}`, { x: 10, y: 100, size: 12, font });
    if (o.rotate) page.setRotation(degrees(o.rotate));
  }
  if (o.title) doc.setTitle(o.title);
  return doc.save();
}

const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());
const rotations = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getRotation().angle);

/** A PDF with an /Encrypt entry in its trailer, like a password-protected file. */
async function makeEncrypted() {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const hex = "00".repeat(32);
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: "Standard", V: 1, R: 2, O: PDFHexString.of(hex), U: PDFHexString.of(hex), P: -4 });
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of("ab".repeat(16)), PDFHexString.of("ab".repeat(16))]);
  return doc.save({ useObjectStreams: false });
}

describe("loadPdf", () => {
  it("refuses password-protected files with a clear message", async () => {
    await expect(loadPdf(await makeEncrypted())).rejects.toThrow(ENCRYPTED);
  });

  it("explains files that aren't PDFs", async () => {
    await expect(loadPdf(new TextEncoder().encode("hello"))).rejects.toThrow(/isn't a readable PDF/);
  });

  it("keeps the original producer (no pdf-lib stamp)", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    doc.setProducer("Acme Writer");
    const loaded = await loadPdf(await doc.save());
    expect(loaded.getProducer()).toBe("Acme Writer");
  });
});

describe("mergePdfs", () => {
  it("appends every page in file order", async () => {
    const progress: number[] = [];
    const { bytes, pages } = await mergePdfs([await makePdf(2), await makePdf(3)], (p) => progress.push(p));
    expect(pages).toBe(5);
    expect(await widths(bytes)).toEqual([100, 110, 100, 110, 120]);
    expect(progress.at(-1)).toBe(1);
  });

  it("keeps page rotation", async () => {
    const { bytes } = await mergePdfs([await makePdf(1, { rotate: 90 }), await makePdf(1)]);
    expect(await rotations(bytes)).toEqual([90, 0]);
  });
});

describe("splitPdf", () => {
  it("writes one file per plan part with the right pages", async () => {
    const src = await loadPdf(await makePdf(5));
    const out = await splitPdf(src, splitPlan(5, "ranges", { ranges: "1-2, 5, 4-3" }));
    expect(out.map((o) => o.suffix)).toEqual(["1-2", "5", "4-3"]);
    expect(out.map((o) => o.pages)).toEqual([2, 1, 2]);
    expect(await widths(out[0].bytes)).toEqual([100, 110]);
    expect(await widths(out[2].bytes)).toEqual([130, 120]);
  });

  it("every page → single-page files", async () => {
    const out = await splitPdf(await loadPdf(await makePdf(3)), splitPlan(3, "pages"));
    expect(out).toHaveLength(3);
    for (const o of out) expect((await PDFDocument.load(o.bytes)).getPageCount()).toBe(1);
  });
});

describe("organizePdf", () => {
  it("reorders, rotates and drops pages", async () => {
    const out = await organizePdf(await makePdf(4, { rotate: 90 }), [
      { index: 3, rotate: 0 },
      { index: 0, rotate: 90 },
      { index: 2, rotate: -90 },
    ]);
    expect(await widths(out)).toEqual([130, 100, 120]);
    expect(await rotations(out)).toEqual([90, 180, 0]);
  });

  it("keeps the document info", async () => {
    const out = await organizePdf(await makePdf(2, { title: "Quarterly" }), [{ index: 1, rotate: 0 }]);
    expect((await PDFDocument.load(out)).getTitle()).toBe("Quarterly");
  });

  it("needs at least one page", async () => {
    await expect(organizePdf(await makePdf(2), [])).rejects.toThrow("Keep at least one page");
  });
});

describe("rotatePdf", () => {
  it("rotates all pages, wrapping past 360", async () => {
    expect(await rotations(await rotatePdf(await makePdf(2, { rotate: 270 }), 180))).toEqual([90, 90]);
  });

  it("rotates only the selected pages", async () => {
    expect(await rotations(await rotatePdf(await makePdf(3), 270, "2"))).toEqual([0, 270, 0]);
  });
});

describe("removePages", () => {
  it("removes pages and really drops their objects", async () => {
    // Big uncompressed content on page 2 makes the size drop visible.
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const heavy = doc.addPage([110, 100]);
    for (let i = 0; i < 400; i++) heavy.drawRectangle({ x: i % 90, y: i % 80, width: 5, height: 5 });
    doc.addPage([120, 100]);
    const input = await doc.save();
    const { bytes, pages } = await removePages(input, "2");
    expect(pages).toBe(2);
    expect(await widths(bytes)).toEqual([100, 120]);
    expect(bytes.length).toBeLessThan(input.length / 2);
  });

  it("won't remove every page", async () => {
    await expect(removePages(await makePdf(2), "1-last")).rejects.toThrow("You can't remove every page");
  });
});

describe("optimizePdf", () => {
  it("deflates uncompressed streams and keeps every page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    // An uncompressed content stream full of repetitive operators.
    const raw = doc.context.stream("0 0 m 100 100 l S\n".repeat(500));
    page.node.set(PDFName.of("Contents"), doc.context.register(raw));
    const input = await doc.save({ useObjectStreams: false });
    const out = await optimizePdf(input);
    expect(out.length).toBeLessThan(input.length / 4);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe("pdfFromJpegs", () => {
  it("makes one page per image at the given size", async () => {
    const jpg = new Uint8Array(readFileSync(new URL("../../../e2e/fixtures/photo.jpg", import.meta.url)));
    const out = await pdfFromJpegs([
      { jpg, width: 300, height: 400 },
      { jpg, width: 500, height: 200 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [300, 400],
      [500, 200],
    ]);
  });
});

describe("metadata", () => {
  it("writes, clears and reads back info fields", async () => {
    const input = await makePdf(2, { title: "Old" });
    const out = await writeMeta(input, { title: "Yıllık Rapor", author: "Ayşe", subject: "", keywords: "a, b", creator: "", producer: "" });
    const meta = await readMeta(out);
    expect(meta).toMatchObject({ title: "Yıllık Rapor", author: "Ayşe", subject: "", keywords: "a, b", producer: "", pages: 2 });
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
    expect(doc.getModificationDate()).toBeInstanceOf(Date);
  });
});
