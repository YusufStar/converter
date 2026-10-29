import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { downloadAll, downloadOne, fixture, openTool, runAndWait, sniff, trackErrors, uploadFiles, type Downloaded } from "./helpers";

// The first run of every test downloads + compiles the ~31 MB ffmpeg core.
test.setTimeout(240_000);
// Fake microphone / camera / screen for the recorders (whole file: launch options can't be scoped to a group).
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture"],
  },
  permissions: ["microphone", "camera"],
});
const RUN = 200_000;

const pick = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();
const toggle = (page: Page, name: RegExp) => page.getByRole("switch", { name }).click({ force: true });

interface Probe {
  duration: number;
  streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; side_data_list?: { rotation?: number }[] }[];
}

/** Runs the system ffprobe on downloaded bytes. */
function probe(out: Downloaded, info: TestInfo): Probe {
  const path = info.outputPath(out.name.replace(/[^\w.-]/g, "_"));
  writeFileSync(path, out.bytes);
  const json = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:stream_side_data=rotation:format=duration", "-of", "json", path], { encoding: "utf8" }),
  );
  return { duration: Number(json.format?.duration ?? NaN), streams: json.streams };
}
const video = (p: Probe) => p.streams.find((s) => s.codec_type === "video")!;
const audio = (p: Probe) => p.streams.find((s) => s.codec_type === "audio");

test("the media engine runs multi-threaded in an isolated page", async ({ page }) => {
  await openTool(page, "resize-video");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  // Warm-up starts on mount, before any file is added.
  const status = page.getByTestId("engine-status");
  await expect(status).toHaveAttribute("data-phase", "ready", { timeout: RUN });
  await expect(status).toHaveAttribute("data-kind", "mt");
  await expect(status).toContainText("threads");
});

test.describe("resize-video", () => {
  test("preset 360p upscales and copies the audio", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openTool(page, "resize-video");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await pick(page, "360p");
    await runAndWait(page, RUN);
    await expect(page.getByTestId("results")).toContainText("640×360");
    const out = await downloadOne(page);
    expect(out.name).toBe("media-extra-land.mp4");
    const p = probe(out, info);
    expect(video(p)).toMatchObject({ codec_name: "h264", width: 640, height: 360 });
    expect(audio(p)?.codec_name).toBe("aac");
    expect(p.duration).toBeCloseTo(2, 0);
    expect(errors).toEqual([]);
  });

  test("social 9:16 with a blurred background", async ({ page }, info) => {
    await openTool(page, "resize-video");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await pick(page, "Social frame");
    await pick(page, "9:16");
    await pick(page, "480p");
    await pick(page, "Blur");
    await runAndWait(page, RUN);
    const p = probe(await downloadOne(page), info);
    expect(video(p)).toMatchObject({ width: 480, height: 854 });
  });

  test("custom width keeps the aspect ratio; bars mode pads", async ({ page }, info) => {
    await openTool(page, "resize-video");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await pick(page, "Custom size");
    await expect(page.getByTestId("run")).toBeDisabled();
    await page.getByLabel("Width", { exact: true }).fill("200");
    await runAndWait(page, RUN);
    expect(video(probe(await downloadOne(page), info))).toMatchObject({ width: 200, height: 112 });

    await pick(page, "Social frame");
    await pick(page, "1:1");
    await pick(page, "Same");
    await pick(page, "Bars");
    await runAndWait(page, RUN);
    expect(video(probe(await downloadOne(page), info))).toMatchObject({ width: 180, height: 180 });
  });
});

test.describe("video-speed", () => {
  test("2× halves the length and keeps the audio", async ({ page }, info) => {
    await openTool(page, "video-speed");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await pick(page, "2×");
    await runAndWait(page, RUN);
    await expect(page.getByTestId("results")).toContainText("0:02 → 0:01");
    const p = probe(await downloadOne(page), info);
    expect(p.duration).toBeGreaterThan(0.85);
    expect(p.duration).toBeLessThan(1.2);
    expect(audio(p)?.codec_name).toBe("aac");
    expect(video(p).r_frame_rate).toBe("24/1");
  });

  test("0.5× without sound, and reverse", async ({ page }, info) => {
    await openTool(page, "video-speed");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await pick(page, "0.5×");
    await toggle(page, /Keep the sound/);
    await runAndWait(page, RUN);
    let p = probe(await downloadOne(page), info);
    expect(p.duration).toBeGreaterThan(3.8);
    expect(p.duration).toBeLessThan(4.3);
    expect(audio(p)).toBeUndefined();

    await pick(page, "1×");
    await toggle(page, /Keep the sound/);
    await toggle(page, /Play backwards/);
    await expect(page.getByTestId("run")).toHaveText("Reverse");
    await runAndWait(page, RUN);
    p = probe(await downloadOne(page), info);
    expect(p.duration).toBeCloseTo(2, 0);
    expect(audio(p)?.codec_name).toBe("aac");
  });
});

test.describe("rotate-video", () => {
  test("lossless 90° only rewrites the rotation flag", async ({ page }, info) => {
    await openTool(page, "rotate-video");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await expect(page.getByRole("switch", { name: /Lossless/ })).toBeChecked();
    await runAndWait(page, RUN);
    await expect(page.getByTestId("results")).toContainText("Lossless · rotation flag 90°");
    const out = await downloadOne(page);
    expect(out.name).toBe("media-extra-land.mp4");
    expect(out.bytes.length).toBe(40692);
    const v = video(probe(out, info));
    expect(v).toMatchObject({ width: 320, height: 180 });
    // ffprobe reports the display matrix counter-clockwise: -90 = turn 90° right.
    expect(v.side_data_list?.[0]?.rotation).toBe(-90);
  });

  test("rotate + mirror re-encodes the pixels", async ({ page }, info) => {
    await openTool(page, "rotate-video");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await pick(page, "90° left");
    await toggle(page, /Mirror/);
    await expect(page.getByRole("switch", { name: /Lossless/ })).toHaveCount(0);
    await runAndWait(page, RUN);
    await expect(page.getByTestId("results")).toContainText("180×320");
    const p = probe(await downloadOne(page), info);
    expect(video(p)).toMatchObject({ codec_name: "h264", width: 180, height: 320 });
    expect(video(p).side_data_list).toBeUndefined();
    expect(audio(p)?.codec_name).toBe("aac");
  });
});

test.describe("merge-videos", () => {
  test("matching clips are joined by stream copy", async ({ page }, info) => {
    await openTool(page, "merge-videos");
    await uploadFiles(page, ["media-extra-land.mp4"]);
    await expect(page.getByTestId("run")).toBeDisabled();
    await page.getByTestId("file-input").setInputFiles([fixture("media-extra-land2.mp4")]);
    await runAndWait(page, RUN);
    await expect(page.getByTestId("results")).toContainText("Joined without re-encoding");
    const out = await downloadOne(page);
    expect(out.name).toBe("media-extra-land-merged.mp4");
    const p = probe(out, info);
    expect(p.duration).toBeGreaterThan(2.9);
    expect(p.duration).toBeLessThan(3.2);
    expect(video(p)).toMatchObject({ codec_name: "h264", width: 320, height: 180 });
    expect(audio(p)?.codec_name).toBe("aac");
  });

  test("different clips are normalised to the first one (order matters), silence added", async ({ page }, info) => {
    await openTool(page, "merge-videos");
    await page.getByTestId("file-input").setInputFiles([fixture("media-extra-portrait-silent.mp4"), fixture("media-extra-land.mp4")]);
    await expect(page.getByTestId("queue").locator("li")).toHaveCount(2);
    // Put the landscape clip first: it sets the output frame.
    await page.getByTestId("queue").locator("li").nth(1).getByRole("button", { name: "Move up" }).click();
    await expect(page.getByTestId("queue").locator("li").first()).toContainText("media-extra-land.mp4");
    await runAndWait(page, RUN);
    await expect(page.getByTestId("results")).toContainText("Converted to 320×180 · 24 fps");
    const out = await downloadOne(page);
    expect(out.name).toBe("media-extra-land-merged.mp4");
    const p = probe(out, info);
    expect(p.duration).toBeGreaterThan(2.9);
    expect(p.duration).toBeLessThan(3.2);
    expect(video(p)).toMatchObject({ codec_name: "h264", width: 320, height: 180 });
    // ~24 fps: each clip boundary carries a sub-frame gap (AAC frames are 21 ms), as with any concat join.
    const [num, den] = video(p).r_frame_rate!.split("/").map(Number);
    expect(Math.abs(num / den - 24)).toBeLessThan(0.5);
    expect(audio(p)?.codec_name).toBe("aac");
  });
});

test.describe("trim-audio", () => {
  test("waveform handles, typed times, fade and format", async ({ page }, info) => {
    await openTool(page, "trim-audio");
    await uploadFiles(page, ["media-extra-tone.mp3"]);
    const wave = page.getByTestId("waveform");
    await expect(wave).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("selection")).toContainText("0:00 → 0:04");

    // Drag near the left: the start handle follows.
    const box = (await wave.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.02, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("selection")).toContainText("0:01 → 0:04");
    // Keyboard: end handle 1 s earlier.
    await page.getByTestId("handle-end").focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(page.getByTestId("selection")).toContainText("0:01 → 0:03 · 0:02");

    await page.getByLabel("Fade in", { exact: true }).fill("0.5");
    await runAndWait(page, RUN);
    let out = await downloadOne(page);
    expect(out.name).toBe("media-extra-tone.mp3");
    let p = probe(out, info);
    expect(audio(p)?.codec_name).toBe("mp3");
    expect(p.duration).toBeGreaterThan(1.9);
    expect(p.duration).toBeLessThan(2.2);

    await page.getByLabel("Start", { exact: true }).fill("0.5");
    await page.getByLabel("End", { exact: true }).fill("1");
    await pick(page, "WAV");
    await runAndWait(page, RUN);
    out = await downloadOne(page);
    expect(out.name).toBe("media-extra-tone.wav");
    expect(sniff(out.bytes)).toBe("wav");
    p = probe(out, info);
    expect(p.duration).toBeCloseTo(0.5, 1);
  });
});

test.describe("recorders (fake devices)", () => {
  test("voice recorder: level meter, pause/resume, WebM → MP3", async ({ page }, info) => {
    await openTool(page, "voice-recorder");
    await page.getByTestId("rec-start").click();
    await expect(page.getByTestId("rec-clock")).toBeVisible();
    await expect(page.getByTestId("voice-wave")).toBeVisible();
    // The fake microphone beeps: the meter moves.
    await expect.poll(async () => page.getByTestId("voice-meter").evaluate((el) => (el as HTMLElement).style.transform), { timeout: 10_000 }).not.toBe("scaleX(0)");
    await expect(page.getByTestId("rec-clock")).toHaveText("00:01", { timeout: 5_000 });
    await page.getByTestId("rec-pause").click();
    await expect(page.getByText("Paused")).toBeVisible();
    const paused = await page.getByTestId("rec-clock").textContent();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("rec-clock")).toHaveText(paused!);
    await page.getByTestId("rec-pause").click();
    await expect(page.getByTestId("rec-clock")).toHaveText("00:02", { timeout: 5_000 });
    await page.getByTestId("rec-stop").click();

    const webm = await downloadOne(page);
    expect(webm.name).toMatch(/^Voice recording \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.webm$/);
    expect(sniff(webm.bytes)).toBe("webm");
    expect(audio(probe(webm, info))?.codec_name).toBe("opus");

    await page.getByTestId("to-mp3").click();
    await expect(page.getByTestId("download-all")).toBeVisible({ timeout: RUN });
    const { entries } = await downloadAll(page);
    const mp3 = Object.entries(entries).find(([n]) => n.endsWith(".mp3"));
    expect(mp3).toBeTruthy();
    expect(sniff(mp3![1])).toBe("mp3");
    const p = probe({ name: mp3![0], bytes: mp3![1] }, info);
    expect(p.duration).toBeGreaterThan(1.5);
    await expect(page.getByTestId("to-mp3")).toHaveCount(0);
    await expect(page.getByTestId("to-wav")).toBeVisible();
  });

  test("screen recorder: countdown, record, stop, WebM → MP4", async ({ page }, info) => {
    await openTool(page, "screen-recorder");
    await toggle(page, /Tab \/ system audio/);
    await page.getByTestId("rec-start").click();
    await expect(page.getByTestId("countdown")).toHaveText("3");
    await expect(page.getByTestId("rec-clock")).toHaveText("00:02", { timeout: 15_000 });
    await page.getByTestId("rec-stop").click();

    const webm = await downloadOne(page);
    expect(webm.name).toMatch(/^Screen recording .*\.webm$/);
    expect(sniff(webm.bytes)).toBe("webm");
    expect(video(probe(webm, info)).codec_name).toMatch(/^vp[89]$/);

    await page.getByTestId("to-mp4").click();
    await expect(page.getByTestId("download-all")).toBeVisible({ timeout: RUN });
    const { entries } = await downloadAll(page);
    const mp4 = Object.entries(entries).find(([n]) => n.endsWith(".mp4"));
    expect(mp4).toBeTruthy();
    const p = probe({ name: mp4![0], bytes: mp4![1] }, info);
    expect(video(p)).toMatchObject({ codec_name: "h264", r_frame_rate: "30/1" });
    expect(p.duration).toBeGreaterThan(1.5);
  });
});

test("phone width: no horizontal overflow on any new media tool", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const tools: [string, string | null][] = [
    ["resize-video", "media-extra-land.mp4"],
    ["video-speed", "media-extra-land.mp4"],
    ["rotate-video", "media-extra-land.mp4"],
    ["merge-videos", "media-extra-land.mp4"],
    ["trim-audio", "media-extra-tone.mp3"],
    ["screen-recorder", null],
    ["voice-recorder", null],
  ];
  for (const [slug, file] of tools) {
    await openTool(page, slug);
    if (file) await uploadFiles(page, [file]);
    if (slug === "trim-audio") await expect(page.getByTestId("waveform")).toBeVisible({ timeout: 30_000 });
    if (slug === "resize-video") await pick(page, "Social frame");
    await page.screenshot({ path: info.outputPath(`${slug}-phone.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), slug).toBeLessThanOrEqual(360);
  }
});
