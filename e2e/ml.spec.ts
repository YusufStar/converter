import { chromium, expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { downloadAll, downloadOne, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles } from "./helpers";

// Fixtures: ml-ocr-en.png / ml-ocr-tr.png = two lines of English / Turkish text;
// ml-scan.pdf = 2 image-only pages (page 2 has /Rotate 90, drawn to read upright);
// ml-object.jpg = an orange ball on a plain light backdrop.
// These tests download real data at first use (OCR languages ~1–3 MB each, the 88 MB
// background model), so they get generous timeouts.

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const radio = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("image-to-text reads English text (and fits a phone screen)", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openTool(page, "image-to-text");
  await expect(page.getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Warm-up starts on mount: language data downloads before any file is added.
  await expect(page.getByTestId("engine-status")).toContainText("ready", { timeout: 120_000 });
  await uploadFiles(page, ["ml-ocr-en.png"]);
  await noHorizontalScroll(page);
  await runAndWait(page);
  const preview = page.getByTestId("text-preview");
  for (const w of ["quick", "brown", "fox", "lazy", "Invoice", "2048"]) await expect(preview).toContainText(w);
  const out = await downloadOne(page);
  expect(out.name).toBe("ml-ocr-en.txt");
  expect(decode(out.bytes)).toMatch(/The quick brown fox jumps over the lazy dog/);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("image-to-text with Turkish: diacritics, two images into one combined .txt", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await openTool(page, "image-to-text");
  await page.getByRole("button", { name: "Türkçe", exact: true }).click();
  await expect(page.getByRole("button", { name: "Türkçe", exact: true })).toHaveAttribute("aria-pressed", "true");
  await uploadFiles(page, ["ml-ocr-tr.png", "ml-ocr-en.png"]);
  await radio(page, "One combined .txt");
  const t0 = Date.now();
  await runAndWait(page, 180_000);
  console.log(`  eng+tur OCR of 2 images (incl. Turkish data download): ${Date.now() - t0} ms`);
  const out = await downloadOne(page);
  expect(out.name).toBe("extracted-text.txt");
  const text = decode(out.bytes);
  expect(text).toContain("=== ml-ocr-tr.png ===");
  expect(text).toContain("=== ml-ocr-en.png ===");
  for (const w of ["Çağrı", "ılık", "çayını", "içti", "güldü", "Şişli", "güzel", "öğleden", "quick", "lazy"]) expect(text).toContain(w);
  expect(errors).toEqual([]);
});

/** Text per page plus where it sits in the reader's view (pdf.js in Node). */
async function readPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const items = (await p.getTextContent()).items.filter((it) => "str" in it && it.str.trim());
    pages.push({
      width: vp.width,
      height: vp.height,
      text: items.map((it) => ("str" in it ? it.str : "")).join(" "),
      // Text matrix in viewport space: a > 0, b ≈ 0 means it runs left-to-right for the reader.
      boxes: items.map((it) => pdfjs.Util.transform(vp.transform, "transform" in it ? it.transform : [])),
    });
  }
  return pages;
}

test("pdf-ocr makes a scanned PDF searchable (rotated page included) and extracts .txt", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await openTool(page, "pdf-ocr");
  await uploadFiles(page, ["ml-scan.pdf"]);
  await radio(page, "Both");
  const t0 = Date.now();
  await runAndWait(page, 180_000);
  console.log(`  pdf-ocr, 2 pages at 300 dpi: ${Date.now() - t0} ms`);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["ml-scan-ocr.pdf", "ml-scan.txt"]);

  const pdf = zip.entries["ml-scan-ocr.pdf"];
  expect(sniff(pdf)).toBe("pdf");
  const doc = await PDFDocument.load(pdf);
  expect(doc.getPageCount()).toBe(2);
  expect(doc.getPage(1).getRotation().angle).toBe(90);

  const [p1, p2] = await readPdf(pdf);
  for (const w of ["Searchable", "scanner", "Quarterly", "warehouse"]) expect(p1.text).toContain(w);
  for (const w of ["Rotated", "landscape", "manifest", "seventeen"]) expect(p2.text).toContain(w);
  // The invisible words sit over the printed ones: top-left area, upright for the reader.
  for (const [p, area] of [
    [p1, { w: 0.95, h: 0.2 }],
    [p2, { w: 0.7, h: 0.35 }],
  ] as const) {
    for (const [a, b, , , e, f] of p.boxes) {
      expect(a).toBeGreaterThan(0);
      expect(Math.abs(b)).toBeLessThan(0.01);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThan(p.width * area.w);
      expect(f).toBeLessThan(p.height * area.h);
    }
  }
  expect(p2.width).toBeGreaterThan(p2.height);

  const txt = decode(zip.entries["ml-scan.txt"]);
  expect(txt).toContain("Quarterly report");
  expect(txt).toContain("Shipping manifest");
  expect(errors).toEqual([]);
});

/** RGBA pixels of a PNG (upng-js in Node). */
async function rgba(bytes: Uint8Array) {
  const UPNG = (await import("upng-js")).default;
  const img = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const px = new Uint8Array(UPNG.toRGBA8(img)[0]);
  return { width: img.width, at: (x: number, y: number) => px.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4) };
}

test("remove-background cuts out the subject: transparent corners, opaque centre; mask-only WebP re-run", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openTool(page, "remove-background");
  await uploadFiles(page, ["ml-object.jpg"]);
  const t0 = Date.now();
  await runAndWait(page, 240_000);
  await noHorizontalScroll(page);
  console.log(`  remove-background on wasm, first run (88 MB model download + inference): ${Date.now() - t0} ms`);
  await expect(page.getByTestId("compare")).toBeVisible();
  await expect(page.getByTestId("engine-status")).toContainText("Model ready · wasm");

  const out = await downloadOne(page);
  expect(out.name).toBe("ml-object-no-bg.png");
  expect(sniff(out.bytes)).toBe("png");
  expect(imageSize(out.bytes)).toEqual({ width: 320, height: 240 });
  const img = await rgba(out.bytes);
  for (const [x, y] of [
    [2, 2],
    [317, 2],
    [2, 237],
    [317, 237],
    [30, 120],
  ])
    expect(img.at(x, y)[3]).toBeLessThan(16);
  const centre = img.at(160, 120);
  expect(centre[3]).toBeGreaterThan(240);
  expect(centre[0]).toBeGreaterThan(200); // still the orange ball

  // Mask is cached per file: a different backdrop + format re-renders without the model.
  await radio(page, "Mask only");
  await radio(page, "WebP");
  const t1 = Date.now();
  await runAndWait(page);
  console.log(`  remove-background, re-run from the cached mask: ${Date.now() - t1} ms`);
  const mask = await downloadOne(page);
  expect(mask.name).toBe("ml-object-mask.webp");
  expect(sniff(mask.bytes)).toBe("webp");
  expect(imageSize(mask.bytes)).toEqual({ width: 320, height: 240 });
  expect(errors).toEqual([]);
});

test("remove-background runs on the GPU where WebGPU is available", async ({ baseURL }) => {
  test.setTimeout(300_000);
  // Headless Chromium has no GPU adapter by default; these flags expose the real one where there is one.
  const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal"] });
  try {
    const page = await browser.newPage({ baseURL, acceptDownloads: true });
    const errors = trackErrors(page);
    const gpu = await page.goto("/").then(() =>
      page.evaluate(async () => {
        const adapter = await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu?.requestAdapter();
        return Boolean(adapter?.features.has("shader-f16"));
      }),
    );
    test.skip(!gpu, "no WebGPU adapter with shader-f16 here");
    await openTool(page, "remove-background");
    await uploadFiles(page, ["ml-object.jpg"]);
    const t0 = Date.now();
    await runAndWait(page, 240_000);
    console.log(`  remove-background on WebGPU (88 MB download + inference): ${Date.now() - t0} ms`);
    await expect(page.getByTestId("engine-status")).toContainText("WebGPU");
    const img = await rgba((await downloadOne(page)).bytes);
    expect(img.at(2, 2)[3]).toBeLessThan(16);
    expect(img.at(30, 120)[3]).toBeLessThan(16);
    expect(img.at(160, 120)[3]).toBeGreaterThan(240);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
