import { expect, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { downloadAll, downloadOne, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles, test } from "./helpers";

// Fixtures: sample.pdf = 3 A4 pages ("Page N of the sample document");
// pdf-sizes.pdf = pages of 300×400, 400×300, 500×500 pt; pdf-scan.pdf = a photo on 2 small pages;
// pdf-locked.pdf = has an /Encrypt dictionary.

const load = (b: Uint8Array) => PDFDocument.load(b, { updateMetadata: false });
const widths = async (b: Uint8Array) => (await load(b)).getPages().map((p) => p.getWidth());
const rotations = async (b: Uint8Array) => (await load(b)).getPages().map((p) => p.getRotation().angle);

/** Decoded content streams per page, to look for stamped text. */
async function contents(b: Uint8Array): Promise<string[]> {
  const doc = await load(b);
  return doc.getPages().map((page) => {
    const c = page.node.Contents();
    const refs = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
    return refs
      .map((r) => doc.context.lookup(r))
      .map((st) => (st instanceof PDFRawStream ? new TextDecoder("latin1").decode(decodePDFRawStream(st).decode()) : ""))
      .join("\n");
  });
}

/** Helvetica text as pdf-lib writes it: hex of the WinAnsi bytes. */
const hex = (s: string) => `<${[...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join("")}>`;

const radio = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();

test("merge-pdf joins files in list order and follows reordering", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "merge-pdf");
  await uploadFiles(page, ["sample.pdf", "pdf-sizes.pdf"]);
  await runAndWait(page);
  let out = await downloadOne(page);
  expect(out.name).toBe("merged.pdf");
  expect(await widths(out.bytes)).toEqual([595.28, 595.28, 595.28, 300, 400, 500]);

  await page.getByTestId("queue").getByRole("button", { name: "Move up" }).nth(1).click();
  await runAndWait(page);
  out = await downloadOne(page);
  expect(await widths(out.bytes)).toEqual([300, 400, 500, 595.28, 595.28, 595.28]);
  expect(errors).toEqual([]);
});

test("split-pdf: every page → zip of single-page PDFs", async ({ page }) => {
  await openTool(page, "split-pdf");
  await uploadFiles(page, ["sample.pdf"]);
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(zip.name).toBe("sample.zip");
  expect(Object.keys(zip.entries).sort()).toEqual(["sample-p01.pdf", "sample-p02.pdf", "sample-p03.pdf"]);
  for (const bytes of Object.values(zip.entries)) expect((await load(bytes)).getPageCount()).toBe(1);
});

test("split-pdf: custom ranges, reversed range keeps its order", async ({ page }) => {
  await openTool(page, "split-pdf");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  await radio(page, "Custom ranges");
  await expect(page.getByTestId("run")).toBeDisabled();
  await page.getByTestId("ranges").fill("3-1, 2");
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["pdf-sizes-2.pdf", "pdf-sizes-3-1.pdf"]);
  expect(await widths(zip.entries["pdf-sizes-3-1.pdf"])).toEqual([500, 400, 300]);
  expect(await widths(zip.entries["pdf-sizes-2.pdf"])).toEqual([400]);
});

test("extract-pdf-pages: chosen pages in typed order, bad input blocked", async ({ page }) => {
  await openTool(page, "extract-pdf-pages");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  await page.getByTestId("ranges").fill("1-x");
  await expect(page.getByText("Can't read this range")).toBeVisible();
  await expect(page.getByTestId("run")).toBeDisabled();
  await page.getByTestId("ranges").fill("last, 1");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("pdf-sizes-extract.pdf");
  expect(await widths(out.bytes)).toEqual([500, 300]);
});

test("organize-pdf: thumbnails, rotate, delete and reorder", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "organize-pdf");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  const cards = page.getByTestId("page-card");
  await expect(cards).toHaveCount(3);
  // Thumbnails are rendered by pdf.js.
  await expect(cards.first().locator("img")).toBeVisible();
  await expect.poll(() => cards.first().locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(50);

  await page.getByRole("button", { name: "Rotate page 1 right" }).click();
  await page.getByRole("button", { name: "Delete page 2" }).click();
  await expect(page.getByTestId("kept")).toHaveText("2 of 3 pages kept");
  await page.getByRole("button", { name: "Move page 3 left" }).click();
  await page.getByRole("button", { name: "Move page 3 left" }).click();
  await expect(cards.first()).toHaveAttribute("data-page", "3");

  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("pdf-sizes-organized.pdf");
  expect(await widths(out.bytes)).toEqual([500, 300]);
  expect(await rotations(out.bytes)).toEqual([0, 90]);
  expect(errors).toEqual([]);
});

test("organize-pdf: drag and drop moves a page", async ({ page }) => {
  await openTool(page, "organize-pdf");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  const cards = page.getByTestId("page-card");
  await expect(cards).toHaveCount(3);
  await cards.nth(0).dragTo(cards.nth(2), { targetPosition: { x: 140, y: 40 } });
  await expect(cards.nth(2)).toHaveAttribute("data-page", "1");
  await runAndWait(page);
  expect(await widths((await downloadOne(page)).bytes)).toEqual([400, 500, 300]);
});

test("rotate-pdf: only the chosen pages", async ({ page }) => {
  await openTool(page, "rotate-pdf");
  await uploadFiles(page, ["sample.pdf"]);
  await radio(page, "180°");
  await radio(page, "Choose pages");
  await page.getByTestId("ranges").fill("2");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("sample-rotated.pdf");
  expect(await rotations(out.bytes)).toEqual([0, 180, 0]);
});

test("remove-pdf-pages drops the listed pages", async ({ page }) => {
  await openTool(page, "remove-pdf-pages");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  await page.getByTestId("ranges").fill("2");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("pdf-sizes-pages-removed.pdf");
  expect(await widths(out.bytes)).toEqual([300, 500]);
});

test("pdf-to-jpg renders every page at 150 DPI into a zip", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "pdf-to-jpg");
  await uploadFiles(page, ["sample.pdf"]);
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["sample-p01.jpg", "sample-p02.jpg", "sample-p03.jpg"]);
  for (const bytes of Object.values(zip.entries)) {
    expect(sniff(bytes)).toBe("jpg");
    expect(imageSize(bytes)).toEqual({ width: 1240, height: 1754 });
  }
  expect(errors).toEqual([]);
});

test("pdf-to-png: one chosen page at 72 DPI downloads directly", async ({ page }) => {
  await openTool(page, "pdf-to-png");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  await radio(page, "72");
  await radio(page, "Choose pages");
  await page.getByTestId("ranges").fill("last");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("pdf-sizes-p03.png");
  expect(sniff(out.bytes)).toBe("png");
  expect(imageSize(out.bytes)).toEqual({ width: 500, height: 500 });
});

test("pdf-to-webp produces WebP", async ({ page }) => {
  await openTool(page, "pdf-to-webp");
  await uploadFiles(page, ["pdf-scan.pdf"]);
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["pdf-scan-p01.webp", "pdf-scan-p02.webp"]);
  for (const bytes of Object.values(zip.entries)) expect(sniff(bytes)).toBe("webp");
});

test("compress-pdf: strong re-renders pages as JPEG and shrinks the file", async ({ page }) => {
  await openTool(page, "compress-pdf");
  await uploadFiles(page, ["pdf-scan.pdf"]);
  await radio(page, "Strong");
  await expect(page.getByText("Text won't be selectable")).toBeVisible();
  await runAndWait(page);
  await expect(page.getByTestId("results")).toContainText("smaller");
  const out = await downloadOne(page);
  expect(out.name).toBe("pdf-scan-compressed.pdf");
  const doc = await load(out.bytes);
  expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
    [120, 90],
    [120, 90],
  ]);
  // Each page is now a single JPEG image at ~110 DPI.
  const xobj = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  const img = doc.context.lookup(xobj.values()[0]) as PDFRawStream;
  expect(String(img.dict.get(PDFName.of("Filter")))).toBe("/DCTDecode");
  expect(Number(String(img.dict.get(PDFName.of("Width"))))).toBe(183);
});

test("compress-pdf: lossless keeps pages and never grows the file", async ({ page }) => {
  await openTool(page, "compress-pdf");
  await uploadFiles(page, ["sample.pdf"]);
  await radio(page, "Lossless");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.bytes.length).toBeLessThanOrEqual(1481);
  expect((await load(out.bytes)).getPageCount()).toBe(3);
});

test("pdf-page-numbers stamps 'Page n of N'", async ({ page }) => {
  await openTool(page, "pdf-page-numbers");
  await uploadFiles(page, ["sample.pdf"]);
  await page.getByRole("radio", { name: "Top right" }).click();
  await radio(page, "Page 1 of N");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("sample-numbered.pdf");
  const pages = await contents(out.bytes);
  expect(pages).toHaveLength(3);
  pages.forEach((c, i) => expect(c).toContain(hex(`Page ${i + 1} of 3`)));
});

test("pdf-watermark tiles the text on every page", async ({ page }) => {
  await openTool(page, "pdf-watermark");
  await uploadFiles(page, ["sample.pdf"]);
  await page.getByTestId("wm-text").fill("DRAFT");
  await radio(page, "Tiled");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("sample-watermarked.pdf");
  for (const c of await contents(out.bytes)) expect(c.split(hex("DRAFT")).length - 1).toBeGreaterThan(5);
});

test("pdf-watermark handles Turkish text with an embedded Unicode font", async ({ page }) => {
  await openTool(page, "pdf-watermark");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  await page.getByTestId("wm-text").fill("GİZLİ BELGE");
  await runAndWait(page);
  const doc = await load((await downloadOne(page)).bytes);
  const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const names = fonts.values().map((ref) => String(doc.context.lookup(ref, PDFDict).get(PDFName.of("BaseFont"))));
  expect(names.join()).toContain("DejaVuSans");
});

test("pdf-to-text extracts text with a preview and copy button", async ({ page }) => {
  await openTool(page, "pdf-to-text");
  await uploadFiles(page, ["sample.pdf"]);
  await runAndWait(page);
  await expect(page.getByTestId("text-preview")).toContainText("Page 2 of the sample document");
  await expect(page.getByTestId("copy-text")).toBeEnabled();
  const out = await downloadOne(page);
  expect(out.name).toBe("sample.txt");
  const text = new TextDecoder().decode(out.bytes);
  for (const n of [1, 2, 3]) expect(text).toContain(`Page ${n} of the sample document`);
});

test("pdf-metadata reads current values and writes new ones", async ({ page }) => {
  await openTool(page, "pdf-metadata");
  await uploadFiles(page, ["pdf-sizes.pdf"]);
  await expect(page.getByTestId("meta-title")).toHaveValue("Fixture with three page sizes");
  await page.getByTestId("meta-title").fill("Yıllık rapor");
  await page.getByTestId("meta-author").fill("Ayşe Yılmaz");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("pdf-sizes.pdf");
  const doc = await load(out.bytes);
  expect(doc.getTitle()).toBe("Yıllık rapor");
  expect(doc.getAuthor()).toBe("Ayşe Yılmaz");
});

test("password-protected PDFs get a clear error (pdf-lib and pdf.js paths)", async ({ page }) => {
  for (const slug of ["rotate-pdf", "pdf-to-jpg"]) {
    await openTool(page, slug);
    await uploadFiles(page, ["pdf-locked.pdf"]);
    await page.getByTestId("run").click();
    await expect(page.getByTestId("queue")).toContainText("This PDF is password-protected");
    await expect(page.getByTestId("results")).toHaveCount(0);
  }
});
