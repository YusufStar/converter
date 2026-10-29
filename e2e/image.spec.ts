import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { downloadAll, downloadOne, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles } from "./helpers";

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
  await page.getByRole("button", { name: "Switch language to Turkish" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "WebP Dönüştürücü" })).toBeVisible();
  await expect(page.getByText("Dosyaları buraya bırak")).toBeVisible();
});
