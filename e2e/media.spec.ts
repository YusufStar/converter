import { expect, type Page } from "@playwright/test";
import { downloadAll, downloadOne, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles, test } from "./helpers";

// The first run of every test downloads + compiles the 31 MB ffmpeg core.
test.setTimeout(240_000);
const RUN = 200_000;

const pick = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();
const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(text);

test("mp4 → webm (video converter)", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "video-converter");
  await uploadFiles(page, ["clip.mp4"]);
  await pick(page, "WEBM");
  await runAndWait(page, RUN);
  await expect(page.getByTestId("results")).toContainText("320×240");
  const out = await downloadOne(page);
  expect(out.name).toBe("clip.webm");
  expect(sniff(out.bytes)).toBe("webm");
  expect(has(out.bytes, "V_VP8")).toBe(true);
  expect(has(out.bytes, "A_OPUS")).toBe(true);
  expect(errors).toEqual([]);
});

test("mp4 → gif (video to GIF)", async ({ page }) => {
  await openTool(page, "video-to-gif");
  await uploadFiles(page, ["clip.mp4"]);
  await runAndWait(page, RUN);
  const out = await downloadOne(page);
  expect(out.name).toBe("clip.gif");
  expect(sniff(out.bytes)).toBe("gif");
  // 480 px requested, never upscaled past the 320 px source.
  expect(imageSize(out.bytes)).toEqual({ width: 320, height: 240 });
  expect(has(out.bytes, "NETSCAPE2.0")).toBe(true); // loop extension
});

test("mp4 → mp3 (video to MP3)", async ({ page }) => {
  await openTool(page, "video-to-mp3");
  await uploadFiles(page, ["clip.mp4"]);
  await runAndWait(page, RUN);
  const out = await downloadOne(page);
  expect(out.name).toBe("clip.mp3");
  expect(sniff(out.bytes)).toBe("mp3");
});

test("wav → mp3 and wav → flac (audio converter)", async ({ page }) => {
  await openTool(page, "audio-converter");
  await uploadFiles(page, ["tone.wav"]);
  await runAndWait(page, RUN);
  const mp3 = await downloadOne(page);
  expect(mp3.name).toBe("tone.mp3");
  expect(sniff(mp3.bytes)).toBe("mp3");

  await pick(page, "FLAC");
  await expect(page.getByText("FLAC is lossless")).toBeVisible();
  await runAndWait(page, RUN);
  const flac = await downloadOne(page);
  expect(flac.name).toBe("tone.flac");
  expect(sniff(flac.bytes)).toBe("flac");
});

test("trim video (stream copy) keeps MP4 and cuts to 1 s", async ({ page }) => {
  await openTool(page, "trim-video");
  await uploadFiles(page, ["clip.mp4"]);
  await expect(page.getByTestId("run")).toBeDisabled(); // nothing to cut yet
  await page.getByLabel("End", { exact: true }).fill("0:01");
  await runAndWait(page, RUN);
  await expect(page.getByTestId("results")).toContainText("0:01");
  const out = await downloadOne(page);
  expect(out.name).toBe("clip.mp4");
  expect(sniff(out.bytes)).toBe("mp4");
});

test("invalid trim time blocks the run", async ({ page }) => {
  await openTool(page, "trim-video");
  await uploadFiles(page, ["clip.mp4"]);
  await page.getByLabel("Start", { exact: true }).fill("1:75");
  await expect(page.getByText("Use seconds (65) or m:ss (1:05).")).toBeVisible();
  await expect(page.getByTestId("run")).toBeDisabled();
});

test("mute video drops the audio track", async ({ page }) => {
  await openTool(page, "mute-video");
  await uploadFiles(page, ["clip.mp4"]);
  await runAndWait(page, RUN);
  const out = await downloadOne(page);
  expect(out.name).toBe("clip.mp4");
  expect(sniff(out.bytes)).toBe("mp4");
  expect(has(out.bytes, "soun")).toBe(false);
  expect(has(out.bytes, "vide")).toBe(true);
});

test("batch: 2 files → mp3 zip", async ({ page }) => {
  await openTool(page, "audio-converter");
  await uploadFiles(page, ["tone.wav", "clip.mp4"]);
  await runAndWait(page, RUN);
  const { name, entries } = await downloadAll(page);
  expect(name).toBe("audio-converter.zip");
  expect(Object.keys(entries).sort()).toEqual(["clip.mp3", "tone.mp3"]);
  for (const bytes of Object.values(entries)) expect(sniff(bytes)).toBe("mp3");
});

test("video to images: one JPG per second → zip", async ({ page }) => {
  await openTool(page, "video-to-frames");
  await uploadFiles(page, ["clip.mp4"]);
  await runAndWait(page, RUN);
  const { entries } = await downloadAll(page);
  const names = Object.keys(entries).sort();
  expect(names).toEqual(["clip-0001.jpg", "clip-0002.jpg"]);
  for (const bytes of Object.values(entries)) expect(imageSize(bytes)).toEqual({ width: 320, height: 240 });
});

test("video compressor with a target size", async ({ page }) => {
  await openTool(page, "video-compressor");
  await uploadFiles(page, ["clip.mp4"]);
  await page.getByRole("switch", { name: /Target file size/ }).check({ force: true });
  await page.getByLabel("Target", { exact: true }).fill("1");
  await runAndWait(page, RUN);
  const out = await downloadOne(page);
  expect(out.name).toBe("clip.mp4");
  expect(sniff(out.bytes)).toBe("mp4");
  expect(out.bytes.length).toBeLessThan(1024 * 1024);
});
