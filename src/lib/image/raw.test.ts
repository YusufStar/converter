import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inputKind, sameFormat } from "./formats";
import { jpegStream, largestJpeg, tiffOrientation } from "./raw";

/** Minimal JPEG stream: SOI, SOFn with size, SOS, entropy bytes (with a stuffed 0xFF00 and a restart marker), EOI. */
function jpeg(w: number, h: number, sof = 0xc0, entropy = [1, 2, 0xff, 0x00, 3, 0xff, 0xd0, 4]): number[] {
  return [0xff, 0xd8, 0xff, sof, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 2, ...entropy, 0xff, 0xd9];
}

describe("RAW embedded preview", () => {
  it("finds the end of a JPEG stream past stuffed bytes and restart markers", () => {
    const b = new Uint8Array([9, 9, ...jpeg(4, 3), 7]);
    expect(jpegStream(b, 2)).toEqual({ end: b.length - 1, width: 4, height: 3 });
    expect(jpegStream(b, 0)).toBeNull();
  });

  it("picks the largest decodable JPEG and skips lossless (SOF3) sensor data", () => {
    const junk = [0xff, 0xd8, 0xff, 0x00, 1, 2, 3]; // looks like a JPEG start, isn't one
    const b = new Uint8Array([...junk, ...jpeg(160, 120), 5, 5, ...jpeg(6000, 4000, 0xc3), ...jpeg(1620, 1080, 0xc2), 0, 0]);
    const p = largestJpeg(b)!;
    expect([p.width, p.height]).toEqual([1620, 1080]);
    expect(p.bytes[0]).toBe(0xff);
    expect(p.bytes.at(-1)).toBe(0xd9);
    expect(largestJpeg(new Uint8Array(junk))).toBeNull();
  });

  it("reads the preview of a real DNG and its IFD0 orientation", () => {
    const dng = new Uint8Array(readFileSync(join(import.meta.dirname, "../../../e2e/fixtures/image-core-raw.dng")));
    const p = largestJpeg(dng)!;
    expect([p.width, p.height]).toEqual([160, 120]);
    expect(tiffOrientation(dng)).toBe(1);
  });

  it("reads TIFF orientation in both byte orders", () => {
    // II*\0, IFD at 8, one entry: 0x0112 SHORT 1 = 6
    const le = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
    const be = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 8, 0, 0, 0, 0, 0, 0]);
    expect(tiffOrientation(le)).toBe(6);
    expect(tiffOrientation(be)).toBe(8);
    expect(tiffOrientation(new Uint8Array(jpeg(1, 1)))).toBe(1);
  });
});

describe("new input formats", () => {
  it("detects JXL, PSD and camera RAW", () => {
    expect(inputKind({ name: "a.jxl", type: "" })).toBe("jxl");
    expect(inputKind({ name: "a.psd", type: "image/vnd.adobe.photoshop" })).toBe("psd");
    for (const ext of ["dng", "CR2", "cr3", "nef", "arw", "orf", "raf", "rw2", "pef", "srw"]) expect(inputKind({ name: `IMG.${ext}`, type: "" })).toBe("raw");
    // DNG labelled as TIFF by the OS is still RAW
    expect(inputKind({ name: "a.dng", type: "image/tiff" })).toBe("raw");
  });
  it("maps 'same' for the new formats", () => {
    expect(sameFormat({ name: "a.jxl", type: "" })).toBe("jxl");
    expect(sameFormat({ name: "a.psd", type: "" })).toBe("png");
    expect(sameFormat({ name: "a.NEF", type: "" })).toBe("jpg");
  });
});
