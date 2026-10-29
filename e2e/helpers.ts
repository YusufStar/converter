import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

/**
 * Every spec's `test`. The app must never fetch anything from another origin (engines, models,
 * OCR data and fonts are all served by the site itself), so any such request fails the test.
 */
export const test = base.extend<{ sameOriginOnly: void }>({
  sameOriginOnly: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const foreign: string[] = [];
      page.on("request", (req) => {
        const url = new URL(req.url());
        if (url.protocol.startsWith("http") && url.origin !== origin) foreign.push(req.url());
      });
      await use();
      expect(foreign, "requests to other origins").toEqual([]);
    },
    { auto: true },
  ],
});

export const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

/** Opens a tool page and waits for its heading. */
export async function openTool(page: Page, slug: string) {
  await page.goto(`/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

export async function uploadFiles(page: Page, names: string[]) {
  await page.getByTestId("file-input").setInputFiles(names.map(fixture));
  await expect(page.getByTestId("queue").locator("li")).toHaveCount(names.length);
}

/** Clicks Convert and waits until the run finishes and results are shown. */
export async function runAndWait(page: Page, timeout = 120_000) {
  await page.getByTestId("run").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout });
  // The run button comes back once every file is processed.
  await expect(page.getByTestId("run")).toBeVisible({ timeout });
}

export interface Downloaded {
  name: string;
  bytes: Uint8Array;
}

/** Single result: clicks the header Download button. */
export async function downloadOne(page: Page): Promise<Downloaded> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile(await dl.path())) };
}

/** Several results: clicks "Download all (.zip)" and returns the unzipped entries. */
export async function downloadAll(page: Page): Promise<{ name: string; entries: Record<string, Uint8Array> }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-all").click()]);
  const bytes = new Uint8Array(await readFile(await dl.path()));
  return { name: dl.suggestedFilename(), entries: unzipSync(bytes) };
}

/** Collects console errors / uncaught exceptions during a test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

/** Magic-byte sniffing for asserting output formats. */
export function sniff(b: Uint8Array): string {
  const s = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (b[0] === 0x89 && s(1, 3) === "PNG") return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  // JPEG XL: bare codestream, or the ISO BMFF container with a "JXL " signature box.
  if ((b[0] === 0xff && b[1] === 0x0a) || s(4, 4) === "JXL ") return "jxl";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "webp";
  if (s(4, 8) === "ftypavif") return "avif";
  if (s(0, 3) === "GIF") return "gif";
  if (s(0, 2) === "BM") return "bmp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "ico";
  if (s(0, 2) === "II" || s(0, 2) === "MM") return "tiff";
  if (s(0, 5) === "%PDF-") return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b) return "zip";
  if (b[0] === 0x1f && b[1] === 0x8b) return "gzip";
  if (s(4, 4) === "ftyp") return "mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "wav";
  if (s(0, 4) === "OggS") return "ogg";
  if (s(0, 4) === "fLaC") return "flac";
  return "unknown";
}

/** Width/height of PNG/JPG/WEBP(VP8/VP8L/VP8X)/GIF/BMP bytes. */
export function imageSize(b: Uint8Array): { width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  switch (sniff(b)) {
    case "png":
      return { width: v.getUint32(16), height: v.getUint32(20) };
    case "gif":
      return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
    case "bmp":
      return { width: v.getInt32(18, true), height: Math.abs(v.getInt32(22, true)) };
    case "webp": {
      const chunk = String.fromCharCode(...b.slice(12, 16));
      if (chunk === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === "VP8L") {
        const bits = v.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    }
    case "jpg": {
      let p = 2;
      while (p < b.length) {
        const m = b[p + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: v.getUint16(p + 5), width: v.getUint16(p + 7) };
        p += 2 + v.getUint16(p + 2);
      }
    }
  }
  throw new Error("Unknown image format");
}
