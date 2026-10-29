import { expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { downloadAll, downloadOne, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles, test } from "./helpers";

// The image worker's URL: its source path in dev, a hashed chunk in the production build.
const IMAGE_WORKER = /lib\/image\/worker|\/assets\/worker-[\w-]+\.js$/;

const pick = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();

test("batch of mixed images → WebP, Download all zips on click", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "webp-converter");
  await uploadFiles(page, ["photo.jpg", "logo.png", "icon.svg", "photo.heic"]);
  await runAndWait(page);
  await expect(page.getByTestId("results").locator("li")).toHaveCount(4);
  const zip = await downloadAll(page);
  expect(zip.name).toBe("webp-converter.zip");
  expect(Object.keys(zip.entries).sort()).toEqual(["icon.webp", "logo.webp", "photo (2).webp", "photo.webp"]);
  for (const bytes of Object.values(zip.entries)) expect(sniff(bytes)).toBe("webp");
  expect(imageSize(zip.entries["logo.webp"])).toEqual({ width: 200, height: 120 });
  expect(errors).toEqual([]);
});

test("lossless WebP via WebAssembly", async ({ page }) => {
  await openTool(page, "webp-converter");
  await uploadFiles(page, ["logo.png"]);
  await page.getByRole("switch", { name: /Lossless/ }).check();
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(sniff(out.bytes)).toBe("webp");
  expect(String.fromCharCode(...out.bytes.slice(12, 16))).toBe("VP8L"); // lossless bitstream
});

test("SVG renders as a vector at the chosen scale", async ({ page }) => {
  await openTool(page, "svg-converter");
  await uploadFiles(page, ["icon.svg", "viewbox-only.svg"]);
  await page.getByRole("button", { name: "4×", exact: true }).click();
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(imageSize(zip.entries["icon.png"])).toEqual({ width: 256, height: 256 });
  expect(imageSize(zip.entries["viewbox-only.png"])).toEqual({ width: 480, height: 240 });
});

test("SVG to exact width keeps aspect ratio", async ({ page }) => {
  await openTool(page, "svg-converter");
  await uploadFiles(page, ["viewbox-only.svg"]);
  await pick(page, "JPG");
  await pick(page, "W × H");
  await page.getByRole("spinbutton", { name: "Width" }).fill("1000");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("viewbox-only.jpg");
  expect(imageSize(out.bytes)).toEqual({ width: 1000, height: 500 });
});

test("HEIC and TIFF decode to JPG / PNG", async ({ page }) => {
  await openTool(page, "image-converter");
  await uploadFiles(page, ["photo.heic", "scan.tiff"]);
  await pick(page, "JPG");
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(sniff(zip.entries["photo.jpg"])).toBe("jpg");
  expect(imageSize(zip.entries["photo.jpg"])).toEqual({ width: 640, height: 480 });
  expect(imageSize(zip.entries["scan.jpg"])).toEqual({ width: 200, height: 150 });
});

for (const [label, kind] of [
  ["AVIF", "avif"],
  ["GIF", "gif"],
  ["BMP", "bmp"],
  ["TIFF", "tiff"],
  ["ICO", "ico"],
  ["PDF", "pdf"],
] as const) {
  test(`writes ${label}`, async ({ page }) => {
    await openTool(page, "image-converter");
    await uploadFiles(page, ["logo.png"]);
    await pick(page, label);
    await runAndWait(page);
    const out = await downloadOne(page);
    expect(sniff(out.bytes)).toBe(kind);
    if (kind === "pdf") expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1);
  });
}

test("resizer keeps format and caps the longest side", async ({ page }) => {
  await openTool(page, "image-resizer");
  await uploadFiles(page, ["photo.jpg"]);
  await page.getByRole("spinbutton", { name: "Longest side" }).fill("320");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("photo.jpg");
  expect(imageSize(out.bytes)).toEqual({ width: 320, height: 240 });
});

test("compressor hits a target size", async ({ page }) => {
  await openTool(page, "image-compressor");
  await uploadFiles(page, ["photo.jpg"]);
  await page.getByRole("switch", { name: /Limit file size/ }).check();
  await page.getByRole("spinbutton", { name: "Max size" }).fill("12");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(sniff(out.bytes)).toBe("jpg");
  expect(out.bytes.length).toBeLessThanOrEqual(12 * 1024);
});

test("rotate 90° swaps dimensions", async ({ page }) => {
  await openTool(page, "image-rotate");
  await uploadFiles(page, ["photo.jpg"]);
  await pick(page, "90°");
  await runAndWait(page);
  expect(imageSize((await downloadOne(page)).bytes)).toEqual({ width: 480, height: 640 });
});

test("images → one PDF, page per image, in list order", async ({ page }) => {
  await openTool(page, "images-to-pdf");
  await uploadFiles(page, ["photo.jpg", "logo.png", "icon.svg"]);
  await page.getByRole("button", { name: "Move up" }).last().click(); // icon.svg → 2nd
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("images.pdf");
  const doc = await PDFDocument.load(out.bytes);
  expect(doc.getPageCount()).toBe(3);
});

test("images → separate PDFs zipped", async ({ page }) => {
  await openTool(page, "images-to-pdf");
  await uploadFiles(page, ["photo.jpg", "logo.png"]);
  await pick(page, "PDF per image");
  await pick(page, "Fit image");
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["logo.pdf", "photo.pdf"]);
  const photo = await PDFDocument.load(zip.entries["photo.pdf"]);
  expect(photo.getPage(0).getSize()).toEqual({ width: 480, height: 360 }); // 640×480 px at 96 dpi
});

test("animated GIF from images", async ({ page }) => {
  await openTool(page, "gif-maker");
  await uploadFiles(page, ["photo.jpg", "logo.png"]);
  await pick(page, "320px");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(sniff(out.bytes)).toBe("gif");
  expect(imageSize(out.bytes)).toEqual({ width: 320, height: 240 });
});

test("favicon set from SVG", async ({ page }) => {
  await openTool(page, "favicon-generator");
  await uploadFiles(page, ["icon.svg"]);
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(zip.name).toBe("favicons.zip");
  expect(Object.keys(zip.entries)).toEqual(
    expect.arrayContaining(["favicon.ico", "favicon-32x32.png", "apple-touch-icon.png", "android-chrome-512x512.png", "site.webmanifest"]),
  );
  expect(sniff(zip.entries["favicon.ico"])).toBe("ico");
  expect(imageSize(zip.entries["android-chrome-512x512.png"])).toEqual({ width: 512, height: 512 });
});

test("Turkish UI via the language button", async ({ page }) => {
  await openTool(page, "webp-converter");
  await page.getByRole("button", { name: "Language" }).first().click();
  await page.getByRole("button", { name: "Türkçe" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "WebP Dönüştürücü" })).toBeVisible();
  await expect(page.getByText("Dosyaları buraya bırak")).toBeVisible();
});

// ---- image-core: worker pool, JXL / PSD / RAW, before/after compare ----

/** PNG colour type from IHDR: 6 = RGBA, 2 = RGB. */
const pngColorType = (b: Uint8Array) => b[25];

test("converts in a pool of image workers", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "image-converter");
  await uploadFiles(page, ["photo.jpg", "logo.png", "icon.svg", "photo.heic", "scan.tiff"]);
  await pick(page, "WEBP");
  await runAndWait(page);
  await expect(page.getByTestId("results").locator("li")).toHaveCount(5);
  expect(page.workers().some((w) => IMAGE_WORKER.test(w.url()))).toBe(true);
  const zip = await downloadAll(page);
  for (const bytes of Object.values(zip.entries)) expect(sniff(bytes)).toBe("webp");
  expect(imageSize(zip.entries["icon.webp"])).toEqual({ width: 64, height: 64 });
  expect(errors).toEqual([]);
});

test("warms the workers and the AVIF codec when the tool opens", async ({ page }) => {
  const wasm = page.waitForRequest(/avif_enc.*\.wasm/);
  await openTool(page, "avif-converter");
  await wasm; // fetched by a worker before anything is queued
  expect(page.workers().filter((w) => IMAGE_WORKER.test(w.url())).length).toBeGreaterThan(1);
});

test("falls back to the main thread without OffscreenCanvas", async ({ page }) => {
  await page.addInitScript(() => delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas);
  await openTool(page, "image-resizer");
  await uploadFiles(page, ["photo.jpg", "icon.svg"]);
  await page.getByRole("spinbutton", { name: "Longest side" }).fill("320");
  await runAndWait(page);
  expect(page.workers().some((w) => IMAGE_WORKER.test(w.url()))).toBe(false);
  const zip = await downloadAll(page);
  expect(imageSize(zip.entries["photo.jpg"])).toEqual({ width: 320, height: 240 });
});

test("cancel stops the workers, and the next run still works", async ({ page }) => {
  await openTool(page, "avif-converter");
  await uploadFiles(page, ["photo.jpg", "photo.heic", "scan.tiff", "logo.png"]);
  // 4× upscale: big enough AVIF encodes to still be running when Cancel is pressed.
  await pick(page, "Percent");
  await page.getByRole("spinbutton", { name: "Percent" }).fill("400");
  await page.getByTestId("run").click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("run")).toBeVisible();
  await expect(page.getByTestId("queue")).toContainText("Cancelled");
  await page.getByRole("spinbutton", { name: "Percent" }).fill("50");
  await runAndWait(page);
  await expect(page.getByTestId("results").locator("li")).toHaveCount(4);
});

test("JPEG XL in and out", async ({ page }) => {
  await openTool(page, "jxl-converter");
  await uploadFiles(page, ["logo.png"]);
  await runAndWait(page);
  const lossy = await downloadOne(page);
  expect(lossy.name).toBe("logo.jxl");
  expect(sniff(lossy.bytes)).toBe("jxl");
  await page.getByRole("switch", { name: /Lossless/ }).check();
  await runAndWait(page);
  expect(sniff((await downloadOne(page)).bytes)).toBe("jxl");

  await openTool(page, "image-converter");
  await uploadFiles(page, ["image-core-photo.jxl"]);
  await runAndWait(page);
  const png = await downloadOne(page);
  expect(png.name).toBe("image-core-photo.png");
  expect(imageSize(png.bytes)).toEqual({ width: 640, height: 480 });
});

test("resizer keeps JXL as JXL", async ({ page }) => {
  await openTool(page, "image-resizer");
  await uploadFiles(page, ["image-core-photo.jxl"]);
  await page.getByRole("spinbutton", { name: "Longest side" }).fill("320");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("image-core-photo.jxl");
  expect(sniff(out.bytes)).toBe("jxl");
});

test("PSD: flattened composite, or the thumbnail when there is none", async ({ page }) => {
  await openTool(page, "psd-converter");
  await uploadFiles(page, ["image-core-layers.psd", "image-core-nocomposite.psd"]);
  await runAndWait(page);
  const zip = await downloadAll(page);
  const full = zip.entries["image-core-layers.png"];
  expect(imageSize(full)).toEqual({ width: 120, height: 80 });
  expect(pngColorType(full)).toBe(6); // transparency kept
  expect(imageSize(zip.entries["image-core-nocomposite.png"])).toEqual({ width: 64, height: 40 });
});

test("camera RAW: full LibRaw decode", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "raw-converter");
  await uploadFiles(page, ["image-core-raw.dng"]);
  await runAndWait(page);
  await expect(page.getByTestId("results")).toContainText("full RAW decode");
  const out = await downloadOne(page);
  expect(out.name).toBe("image-core-raw.jpg");
  expect(sniff(out.bytes)).toBe("jpg");
  expect(imageSize(out.bytes)).toEqual({ width: 240, height: 160 }); // the sensor data, not the 160×120 preview
  expect(errors).toEqual([]);
});

test("camera RAW: embedded preview without cross-origin isolation", async ({ page }) => {
  // Main-thread path (no OffscreenCanvas) on a page that isn't isolated: LibRaw can't run.
  await page.addInitScript(() => {
    delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    Object.defineProperty(globalThis, "crossOriginIsolated", { value: false });
  });
  await openTool(page, "raw-converter");
  await uploadFiles(page, ["image-core-raw.dng"]);
  await runAndWait(page);
  await expect(page.getByTestId("results")).toContainText("embedded preview");
  expect(imageSize((await downloadOne(page)).bytes)).toEqual({ width: 160, height: 120 });
});

test("before/after compare: click a result, drag or key the divider, zoom", async ({ page }) => {
  await openTool(page, "webp-converter");
  await uploadFiles(page, ["photo.jpg", "photo.heic"]);
  await runAndWait(page);
  await page.getByTestId("results").locator("li").first().click();
  const compare = page.getByTestId("compare");
  await expect(compare).toBeVisible();
  await expect(compare.getByRole("img", { name: "Original" })).toBeVisible();
  await expect(compare.getByRole("img", { name: "Converted" })).toBeVisible();
  const divider = compare.getByRole("slider", { name: "Before / after divider" });
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "52");
  await page.keyboard.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "0");
  // Pointer: click at 75% of the image.
  const box = (await compare.getByRole("img", { name: "Converted" }).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBeCloseTo(75, -1);
  await expect(page.getByTestId("compare-sizes")).toContainText("640×480");
  await compare.getByRole("radio", { name: "100%" }).click();
  expect((await compare.getByRole("img", { name: "Converted" }).boundingBox())!.width).toBeCloseTo(640, 0);
  // Next result: a HEIC original, previewed through the image pool.
  await compare.getByRole("button", { name: "Next result" }).click();
  await expect(compare).toContainText("2/2");
  await expect(compare.getByRole("img", { name: "Original" })).toBeVisible();
  await compare.getByRole("button", { name: "Close comparison" }).click();
  await expect(compare).toBeHidden();
  await page.getByTestId("compare-open").click();
  await expect(compare).toBeVisible();
});
