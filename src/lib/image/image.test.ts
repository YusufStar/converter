import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { encodeBmp } from "./bmp";
import { resolveFormat, inputKind, sameFormat } from "./formats";
import { makeAnimatedGif } from "./gif";
import { encodeIco } from "./ico";
import { jpegOrientation, jpegSize } from "./jpeg";
import { DEFAULT_RESIZE, MAX_AREA, MAX_SIDE, targetSize } from "./resize";
import { imagesToPdf, layoutImage } from "../pdf/images-to-pdf";
import { webManifest } from "./favicon";

const src = { width: 4000, height: 3000 };

describe("targetSize", () => {
  it("original / percent / longest", () => {
    expect(targetSize(src, DEFAULT_RESIZE)).toEqual(src);
    expect(targetSize(src, { ...DEFAULT_RESIZE, mode: "percent", percent: 25 })).toEqual({ width: 1000, height: 750 });
    expect(targetSize(src, { ...DEFAULT_RESIZE, mode: "longest", longest: 1920 })).toEqual({ width: 1920, height: 1440 });
    expect(targetSize({ width: 300, height: 1200 }, { ...DEFAULT_RESIZE, mode: "longest", longest: 600 })).toEqual({ width: 150, height: 600 });
  });
  it("dimensions keep aspect (fit inside) or stretch", () => {
    const d = { ...DEFAULT_RESIZE, mode: "dimensions" as const };
    expect(targetSize(src, { ...d, width: 800, height: null })).toEqual({ width: 800, height: 600 });
    expect(targetSize(src, { ...d, width: null, height: 300 })).toEqual({ width: 400, height: 300 });
    expect(targetSize(src, { ...d, width: 800, height: 800 })).toEqual({ width: 800, height: 600 });
    expect(targetSize(src, { ...d, width: 800, height: 800, keepAspect: false })).toEqual({ width: 800, height: 800 });
    expect(targetSize(src, { ...d, width: null, height: null })).toEqual(src);
  });
  it("noEnlarge applies to raster, not vector", () => {
    const o = { ...DEFAULT_RESIZE, mode: "percent" as const, percent: 200, noEnlarge: true };
    expect(targetSize({ width: 64, height: 64 }, o)).toEqual({ width: 64, height: 64 });
    expect(targetSize({ width: 64, height: 64 }, o, true)).toEqual({ width: 128, height: 128 });
  });
  it("clamps to canvas limits and never returns 0", () => {
    const huge = targetSize({ width: 100, height: 50 }, { ...DEFAULT_RESIZE, mode: "percent", percent: 100000 }, true);
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(MAX_SIDE);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_AREA);
    expect(huge.width / huge.height).toBeCloseTo(2, 1);
    expect(targetSize({ width: 10, height: 10 }, { ...DEFAULT_RESIZE, mode: "percent", percent: 1 })).toEqual({ width: 1, height: 1 });
  });
});

describe("formats", () => {
  it("detects input kinds", () => {
    expect(inputKind({ name: "a.SVG", type: "" })).toBe("svg");
    expect(inputKind({ name: "IMG_1.HEIC", type: "" })).toBe("heic");
    expect(inputKind({ name: "scan.tif", type: "image/tiff" })).toBe("tiff");
    expect(inputKind({ name: "a.png", type: "image/png" })).toBe("raster");
  });
  it("maps 'same' to a writable format", () => {
    expect(sameFormat({ name: "a.jpeg", type: "image/jpeg" })).toBe("jpg");
    expect(sameFormat({ name: "a.heic", type: "" })).toBe("jpg");
    expect(sameFormat({ name: "a.svg", type: "image/svg+xml" })).toBe("png");
    expect(resolveFormat("webp", { name: "a.png", type: "image/png" })).toBe("webp");
  });
});

describe("encoders", () => {
  it("writes a 24-bit bottom-up BMP with padded rows", () => {
    // 3×2: rows are 9 bytes → padded to 12
    const rgba = new Uint8Array(3 * 2 * 4);
    rgba.set([255, 0, 0, 255], 0); // top-left red
    rgba.set([0, 0, 255, 255], (1 * 3 + 2) * 4); // bottom-right blue
    const bmp = encodeBmp(rgba, 3, 2);
    const v = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
    expect(v.getUint32(2, true)).toBe(54 + 24);
    expect(v.getInt32(18, true)).toBe(3);
    expect(v.getInt32(22, true)).toBe(2);
    // first stored row = bottom row; bottom-right pixel blue in BGR at x=2
    expect([...bmp.slice(54 + 6, 54 + 9)]).toEqual([255, 0, 0]);
    // second stored row = top row; top-left red in BGR
    expect([...bmp.slice(54 + 12, 54 + 15)]).toEqual([0, 0, 255]);
  });
  it("packs ICO directory entries", () => {
    const ico = encodeIco([
      { size: 16, png: new Uint8Array([1, 2]) },
      { size: 256, png: new Uint8Array([3, 4, 5]) },
    ]);
    const v = new DataView(ico.buffer);
    expect(v.getUint16(2, true)).toBe(1);
    expect(v.getUint16(4, true)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[6 + 16]).toBe(0); // 256 → 0
    expect(v.getUint32(6 + 8, true)).toBe(2);
    expect(v.getUint32(6 + 12, true)).toBe(38);
    expect([...ico.slice(38)]).toEqual([1, 2, 3, 4, 5]);
  });
  it("makes an animated GIF that loops", async () => {
    const frame = (r: number) => ({ data: new Uint8Array(4 * 4 * 4).map((_, i) => (i % 4 === 0 ? r : 255)), width: 4, height: 4 });
    const gif = await makeAnimatedGif([frame(0), frame(255)], { delay: 100, loop: true });
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe("GIF89a");
    expect(String.fromCharCode(...gif)).toContain("NETSCAPE2.0");
    await expect(makeAnimatedGif([frame(0), { ...frame(0), width: 2, data: new Uint8Array(32) }], { delay: 1, loop: false })).rejects.toThrow();
  });
  it("writes a web manifest", () => {
    expect(JSON.parse(webManifest("Site", "#000000")).icons).toHaveLength(2);
  });
});

/** Minimal JPEG: SOI, APP1 Exif with orientation, SOF0 with size. */
function fakeJpeg(orientation: number | null, w = 640, h = 480): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (orientation !== null) {
    const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const len = payload.length + 2;
    parts.push(0xff, 0xe1, len >> 8, len & 0xff, ...payload);
  }
  parts.push(0xff, 0xc0, 0, 17, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  parts.push(0xff, 0xda, 0, 2);
  return new Uint8Array(parts);
}

describe("jpeg", () => {
  it("reads EXIF orientation", () => {
    expect(jpegOrientation(fakeJpeg(6))).toBe(6);
    expect(jpegOrientation(fakeJpeg(null))).toBe(1);
    expect(jpegOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });
  it("reads SOF size", () => {
    expect(jpegSize(fakeJpeg(1, 1234, 567))).toEqual({ width: 1234, height: 567 });
    expect(jpegSize(new Uint8Array([0, 0]))).toBeNull();
  });
});

describe("images to pdf", () => {
  it("lays out fit-to-image pages in points", () => {
    expect(layoutImage(800, 600, { pageSize: "fit", orientation: "auto", margin: 10, fit: "contain" })).toEqual({ pageW: 620, pageH: 470, x: 10, y: 10, w: 600, h: 450 });
  });
  it("auto-rotates A4 for landscape images and centres them", () => {
    const l = layoutImage(2000, 1000, { pageSize: "a4", orientation: "auto", margin: 0, fit: "contain" });
    expect(l.pageW).toBeGreaterThan(l.pageH);
    expect(l.w).toBeCloseTo(841.89, 1);
    expect(l.y).toBeCloseTo((595.28 - l.h) / 2, 3);
    const p = layoutImage(2000, 1000, { pageSize: "a4", orientation: "portrait", margin: 0, fit: "contain" });
    expect(p.pageW).toBeLessThan(p.pageH);
  });
  it("cover fills the box, stretch ignores aspect", () => {
    const c = layoutImage(100, 100, { pageSize: "letter", orientation: "portrait", margin: 0, fit: "cover" });
    expect(c.h).toBeCloseTo(792);
    expect(c.w).toBeCloseTo(792);
    const s = layoutImage(100, 100, { pageSize: "letter", orientation: "portrait", margin: 36, fit: "stretch" });
    expect([s.w, s.h]).toEqual([540, 720]);
  });
  it("creates one page per image", async () => {
    // 1×1 PNG
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const bytes = await imagesToPdf(
      [
        { bytes: png, kind: "png", width: 1, height: 1 },
        { bytes: png, kind: "png", width: 1, height: 1 },
        { bytes: png, kind: "png", width: 1, height: 1 },
      ],
      { pageSize: "a4", orientation: "auto", margin: 0, fit: "contain" },
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
  });
});
