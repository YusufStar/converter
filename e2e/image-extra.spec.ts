import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import UPNG from "upng-js";
import { readGroups, summarize } from "../src/lib/image-extra/exif";
import { downloadAll, downloadOne, fixture, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles, test } from "./helpers";

const pick = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();
const num = (page: Page, name: string) => page.getByRole("spinbutton", { name, exact: true });
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** RGBA of pixel (x, y) of PNG bytes. */
function pngPixel(b: Uint8Array, x: number, y: number): number[] {
  const img = UPNG.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);
  const i = (y * img.width + x) * 4;
  return [...rgba.slice(i, i + 4)];
}

/** Compressed image data of a JPEG: from the first SOS to EOI. */
function jpegScan(b: Uint8Array): Uint8Array {
  for (let i = 2; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === 0xda) return b.subarray(i, b.lastIndexOf(0xd9) + 1);
  throw new Error("no SOS");
}

// ── Crop ───────────────────────────────────────────────────────────────────

test("crop: exact pixel fields cut the right region at full resolution", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "crop-image");
  await uploadFiles(page, ["image-extra-split.png"]);
  await expect(page.getByTestId("crop-box")).toBeVisible();
  await num(page, "X").fill("100");
  await num(page, "Y").fill("0");
  await num(page, "Width").fill("100");
  await num(page, "Height").fill("100");
  await expect(page.getByTestId("crop-size")).toHaveText("100×100");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("image-extra-split-cropped.png");
  expect(imageSize(out.bytes)).toEqual({ width: 100, height: 100 });
  expect(pngPixel(out.bytes, 0, 0)).toEqual([0, 0, 255, 255]);
  expect(pngPixel(out.bytes, 99, 99)).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

test("crop: honours EXIF orientation and aspect presets", async ({ page }) => {
  await openTool(page, "crop-image");
  // Stored 160×120 with Orientation 6 → shown and cropped as 120×160.
  await uploadFiles(page, ["image-extra-gps.jpg"]);
  await num(page, "X").fill("0");
  await num(page, "Y").fill("0");
  await num(page, "Width").fill("120");
  await num(page, "Height").fill("160");
  await expect(page.getByTestId("crop-size")).toHaveText("120×160");
  await runAndWait(page);
  let out = await downloadOne(page);
  expect(sniff(out.bytes)).toBe("jpg");
  expect(imageSize(out.bytes)).toEqual({ width: 120, height: 160 });

  await pick(page, "1:1");
  await expect(page.getByTestId("crop-size")).toHaveText("120×120");
  await pick(page, "PNG");
  await runAndWait(page);
  out = await downloadOne(page);
  expect(out.name).toBe("image-extra-gps-cropped.png");
  expect(imageSize(out.bytes)).toEqual({ width: 120, height: 120 });

  // Custom ratio W:H
  await pick(page, "Custom");
  await num(page, "Ratio width").fill("2");
  await num(page, "Ratio height").fill("1");
  await expect(page.getByTestId("crop-size")).toHaveText("120×60");
});

test("crop: drag handles, move the box and nudge with arrow keys", async ({ page }) => {
  await openTool(page, "crop-image");
  await uploadFiles(page, ["image-extra-split.png"]);
  const box = page.getByTestId("crop-box");
  await expect(box).toBeVisible();
  // Default box: 10% inset → 160×80 at (20, 10)
  await expect(page.getByTestId("crop-size")).toHaveText("160×80");
  const se = await box.locator('[data-handle="se"]').boundingBox();
  await page.mouse.move(se!.x + se!.width / 2, se!.y + se!.height / 2);
  await page.mouse.down();
  await page.mouse.move(se!.x + se!.width / 2 - 60, se!.y + se!.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  const w = Number(await num(page, "Width").inputValue());
  expect(w).toBeLessThan(160);
  expect(w).toBeGreaterThan(20);

  // Move the whole box: it can't leave the image.
  const b = await box.boundingBox();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x - 500, b!.y - 500, { steps: 5 });
  await page.mouse.up();
  await expect(num(page, "X")).toHaveValue("0");
  await expect(num(page, "Y")).toHaveValue("0");

  await box.focus();
  await page.keyboard.press("ArrowRight");
  await expect(num(page, "X")).toHaveValue("1");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(num(page, "Y")).toHaveValue("10");
});

test("crop: batch — centre each to an aspect, adjust one image, output WebP", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "crop-image");
  await uploadFiles(page, ["image-extra-split.png", "image-extra-gps.jpg"]);
  await pick(page, "Center each");
  await pick(page, "16:9");
  await expect(page.getByTestId("crop-size")).toHaveText("178×100");
  // Edit the second image only.
  await page.getByRole("button", { name: "image-extra-gps.jpg", exact: true }).click();
  await expect(page.getByTestId("crop-size")).toHaveText("120×68");
  await num(page, "Width").fill("90");
  await expect(page.getByTestId("crop-size")).toHaveText("90×51");
  await pick(page, "WEBP");
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(zip.name).toBe("crop-image.zip");
  expect(imageSize(zip.entries["image-extra-split-cropped.webp"])).toEqual({ width: 178, height: 100 });
  expect(imageSize(zip.entries["image-extra-gps-cropped.webp"])).toEqual({ width: 90, height: 51 });
  expect(errors).toEqual([]);
});

test("crop: same region proportionally for all", async ({ page }) => {
  await openTool(page, "crop-image");
  await uploadFiles(page, ["image-extra-split.png", "image-extra-gps.jpg"]);
  await num(page, "X").fill("0");
  await num(page, "Y").fill("0");
  await num(page, "Width").fill("100");
  await num(page, "Height").fill("100");
  await runAndWait(page);
  const zip = await downloadAll(page);
  // Left half, full height of each image.
  expect(imageSize(zip.entries["image-extra-split-cropped.png"])).toEqual({ width: 100, height: 100 });
  expect(imageSize(zip.entries["image-extra-gps-cropped.jpg"])).toEqual({ width: 60, height: 160 });
  expect(pngPixel(zip.entries["image-extra-split-cropped.png"], 50, 50)).toEqual([255, 0, 0, 255]);
});

test("crop and vectorize fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const slug of ["crop-image", "image-to-svg", "exif-viewer"]) {
    await openTool(page, slug);
    await uploadFiles(page, ["image-extra-gps.jpg", "image-extra-split.png"]);
    await expect(page.getByTestId("queue")).toBeVisible();
    await page.waitForTimeout(300);
    await noHorizontalOverflow(page);
  }
});

test("every tool renders in Turkish without errors", async ({ page }) => {
  const errors = trackErrors(page);
  for (const slug of ["crop-image", "exif-viewer", "remove-exif", "image-to-svg"]) {
    await openTool(page, `tr/${slug}`);
    await uploadFiles(page, ["image-extra-gps.jpg"]);
    await expect(page.getByTestId("run")).toBeEnabled();
  }
  await expect(page.getByTestId("metadata").or(page.getByTestId("svg-preview"))).toBeVisible();
  expect(errors).toEqual([]);
});

// ── EXIF viewer ────────────────────────────────────────────────────────────

test("exif viewer: summary, GPS map link, searchable raw tags and JSON export", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "exif-viewer");
  await uploadFiles(page, ["image-extra-gps.jpg"]);
  const m = page.getByTestId("metadata");
  await expect(m).toContainText("Canon EOS R5");
  await expect(m).toContainText("RF50mm F1.8 STM");
  await expect(m).toContainText("1/250 s · f/2.8 · ISO 400");
  await expect(m).toContainText("50 mm");
  await expect(m).toContainText("2024-05-01 10:00:00");
  await expect(m).toContainText("120 × 160 px");
  await expect(m).toContainText("Rotate 90 CW");
  const gps = page.getByTestId("gps");
  await expect(gps).toContainText("41.015000, 28.975000");
  await expect(gps).toContainText("41° 0′ 54″ N");
  await expect(gps.getByRole("link", { name: "Open in OpenStreetMap" })).toHaveAttribute("href", /mlat=41\.015&mlon=28\.975/);

  const raw = page.getByTestId("raw-tags");
  await raw.locator("summary").click();
  await raw.getByRole("searchbox").fill("lens");
  await expect(raw).toContainText("LensModel");
  await expect(raw).not.toContainText("GPSLatitude");
  await raw.getByRole("searchbox").fill("zzz-nothing");
  await expect(raw).toContainText("No tag matches");

  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("image-extra-gps-metadata.json");
  const json = JSON.parse(text(out.bytes));
  expect(json.summary.camera).toBe("Canon EOS R5");
  expect(json.summary.gps.lat).toBeCloseTo(41.015, 4);
  expect(json.tags.exif.FNumber).toBe(2.8);
  expect(errors).toEqual([]);
});

test("exif viewer: WebP and PNG metadata, clean files say so", async ({ page }) => {
  await openTool(page, "exif-viewer");
  await uploadFiles(page, ["image-extra-meta.webp", "image-extra-meta.png", "image-extra-split.png"]);
  await expect(page.getByTestId("metadata")).toContainText("Canon EOS R5");
  await page.getByRole("button", { name: "image-extra-meta.png", exact: true }).click();
  await expect(page.getByTestId("metadata")).toContainText("Jane Doe");
  await page.getByRole("button", { name: "image-extra-split.png", exact: true }).click();
  await expect(page.getByTestId("metadata")).toContainText("No metadata found");
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["image-extra-meta-metadata (2).json", "image-extra-meta-metadata.json", "image-extra-split-metadata.json"]);
});

// ── Remove EXIF ────────────────────────────────────────────────────────────

test("remove exif: JPEG, PNG and WebP cleaned losslessly, orientation kept", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "remove-exif");
  await uploadFiles(page, ["image-extra-gps.jpg", "image-extra-meta.png", "image-extra-meta.webp"]);
  await runAndWait(page);
  const results = page.getByTestId("results");
  await expect(results.locator("li").nth(0)).toContainText("Removed GPS, camera, date, comment, embedded extras");
  await expect(results.locator("li").nth(0)).toContainText("orientation kept");
  await expect(results.locator("li").nth(1)).toContainText("Removed GPS, camera, date");
  const zip = await downloadAll(page);
  expect(zip.name).toBe("remove-exif.zip");
  const jpg = zip.entries["image-extra-gps.jpg"];
  const png = zip.entries["image-extra-meta.png"];
  const webp = zip.entries["image-extra-meta.webp"];

  const src = new Uint8Array(await readFile(fixture("image-extra-gps.jpg")));
  expect(jpegScan(jpg)).toEqual(jpegScan(src));
  expect(latin1(jpg)).toContain("ICC_PROFILE"); // kept by default
  for (const b of [jpg, png, webp]) {
    const g = await readGroups(b);
    expect(g.gps).toBeUndefined();
    expect(summarize(g).camera).toBeUndefined();
    expect(g.xmp).toBeUndefined();
  }
  expect((await readGroups(jpg)).ifd0).toEqual({ Orientation: "Rotate 90 CW" });
  expect((await readGroups(webp)).ifd0).toEqual({ Orientation: "Rotate 90 CW" });
  expect((await readGroups(png)).ihdr?.Author).toBeUndefined();
  expect(imageSize(png)).toEqual({ width: 64, height: 48 });
  expect(sniff(webp)).toBe("webp");
  expect(errors).toEqual([]);
});

test("remove exif: drop the colour profile; HEIC is re-encoded to JPG", async ({ page }) => {
  await openTool(page, "remove-exif");
  await uploadFiles(page, ["image-extra-gps.jpg", "photo.heic"]);
  await page.getByRole("switch", { name: /Keep colour profile/ }).uncheck();
  await runAndWait(page);
  await expect(page.getByTestId("results").locator("li").nth(0)).toContainText("colour profile");
  await expect(page.getByTestId("results").locator("li").nth(1)).toContainText("re-encoded as JPG");
  const zip = await downloadAll(page);
  expect(latin1(zip.entries["image-extra-gps.jpg"])).not.toContain("ICC_PROFILE");
  expect(sniff(zip.entries["photo.jpg"])).toBe("jpg");
  expect(imageSize(zip.entries["photo.jpg"])).toEqual({ width: 640, height: 480 });
  // Only what the browser's encoder writes itself (JFIF, sometimes an sRGB profile).
  expect(Object.keys(await readGroups(zip.entries["photo.jpg"])).filter((k) => k !== "jfif" && k !== "icc")).toEqual([]);
});

// ── Image to SVG ───────────────────────────────────────────────────────────

test("image to svg: live preview, exact colours, background removal", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "image-to-svg");
  await uploadFiles(page, ["image-extra-shapes.png"]);
  const preview = page.getByTestId("svg-preview");
  await expect(preview.getByRole("img", { name: "SVG" })).toBeVisible();
  await expect(preview).toContainText(/\d+ shapes/);
  await page.getByRole("slider", { name: "Colours" }).fill("3");
  await page.getByRole("slider", { name: "Smoothing" }).fill("0");
  await runAndWait(page);
  let out = await downloadOne(page);
  expect(out.name).toBe("image-extra-shapes.svg");
  let svg = text(out.bytes);
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="120" height="80" viewBox="0 0 120 80">/);
  expect(svg).toContain('fill="#f00"');
  expect(svg).toContain('fill="#00f"');
  expect(svg).toContain('fill="#fff"');

  await page.getByRole("switch", { name: /Remove background/ }).check();
  await runAndWait(page);
  out = await downloadOne(page);
  svg = text(out.bytes);
  expect(svg).not.toContain('fill="#fff"');
  expect(svg).toContain('fill="#f00"');
  expect(errors).toEqual([]);
});

test("image to svg: line art preset and a batch", async ({ page }) => {
  await openTool(page, "image-to-svg");
  await uploadFiles(page, ["image-extra-shapes.png", "image-extra-gps.jpg"]);
  await pick(page, "Line art (B&W)");
  await expect(page.getByRole("switch", { name: /Remove background/ })).toBeChecked();
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["image-extra-gps.svg", "image-extra-shapes.svg"]);
  const shapes = text(zip.entries["image-extra-shapes.svg"]);
  expect(shapes).toContain('fill="#000"');
  expect(shapes).not.toContain('fill="#fff"');
  // Oriented size of the JPEG
  expect(text(zip.entries["image-extra-gps.svg"])).toContain('width="120" height="160"');
});
