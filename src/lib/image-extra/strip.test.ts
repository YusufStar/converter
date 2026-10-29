import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countTags, readGroups, removalReport, summarize, webpAsJpegShell } from "./exif";
import { crc32, losslessFormat, orientationTiff, stripJpeg, stripMetadata, stripPng, stripWebp, tiffOrientation } from "./strip";
import { jpegWithMetadata, makePng, pngMetadataChunks, sampleTiff, webpWithMetadata } from "./test-images";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../e2e/fixtures/${name}`, import.meta.url)));
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const KEEP = { keepIcc: true };
const DROP = { keepIcc: false };

/** Bytes from the first SOS marker to EOI: the compressed image itself. */
function jpegScan(b: Uint8Array): Uint8Array {
  for (let i = 2; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === 0xda) return b.subarray(i, b.lastIndexOf(0xd9) + 1);
  throw new Error("no SOS");
}

const pngChunks = (b: Uint8Array) => {
  const out: string[] = [];
  const v = new DataView(b.buffer, b.byteOffset);
  for (let p = 8; p + 12 <= b.length; p += 12 + v.getUint32(p)) out.push(text(b.subarray(p + 4, p + 8)));
  return out;
};

const riffChunks = (b: Uint8Array) => {
  const out: string[] = [];
  const v = new DataView(b.buffer, b.byteOffset);
  for (let p = 12; p + 8 <= b.length; ) {
    const size = v.getUint32(p + 4, true);
    out.push(text(b.subarray(p, p + 4)));
    p += 8 + size + (size & 1);
  }
  return out;
};

describe("helpers", () => {
  it("crc32 matches the PNG reference value", () => {
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });

  it("reads orientation from big- and little-endian TIFF and writes it back", () => {
    expect(tiffOrientation(sampleTiff(6))).toBe(6);
    expect(tiffOrientation(orientationTiff(8))).toBe(8);
    // little-endian: II*\0, IFD at 8, one entry 0x0112 SHORT 3
    const le = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0]);
    expect(tiffOrientation(le)).toBe(3);
    expect(tiffOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });

  it("sniffs containers", () => {
    expect(losslessFormat(fixture("photo.jpg"))).toBe("jpeg");
    expect(losslessFormat(fixture("logo.png"))).toBe("png");
    expect(losslessFormat(fixture("photo.webp"))).toBe("webp");
    expect(losslessFormat(fixture("scan.tiff"))).toBeNull();
    expect(() => stripMetadata(fixture("scan.tiff"), KEEP)).toThrow(/losslessly/);
  });
});

describe("JPEG", () => {
  // photo.jpg carries an encoder comment; the stripped copy is the clean base.
  const original = fixture("photo.jpg");
  const base = stripJpeg(original, DROP).bytes;
  const dirty = jpegWithMetadata(base, 6);

  it("drops EXIF, XMP, IPTC, comments and trailing data, keeps the scan byte-identical", async () => {
    const r = stripJpeg(dirty, KEEP);
    expect(r.removed.map((x) => x.kind)).toEqual(["exif", "xmp", "iptc", "comment", "extra"]);
    expect(jpegScan(r.bytes)).toEqual(jpegScan(base));
    expect(text(r.bytes)).not.toContain("Canon");
    expect(text(r.bytes)).not.toContain("Jane Doe");
    expect(text(r.bytes)).not.toContain("TRAILING");
    expect(text(r.bytes)).toContain("JFIF\0");
    expect(text(r.bytes)).toContain("ICC_PROFILE\0");

    const g = await readGroups(r.bytes);
    expect(g.gps).toBeUndefined();
    expect(g.exif).toBeUndefined();
    expect(g.xmp).toBeUndefined();
    expect(g.iptc).toBeUndefined();
    expect(g.ifd0).toEqual({ Orientation: "Rotate 90 CW" });
    expect(g.icc).toBeDefined();
  });

  it("keeps a minimal EXIF with only the orientation, right after JFIF", () => {
    const r = stripJpeg(dirty, KEEP);
    expect(r.orientation).toBe(6);
    expect(r.keptOrientation).toBe(true);
    const jfifLen = (r.bytes[4] << 8) | r.bytes[5];
    const app1 = 4 + jfifLen;
    expect([r.bytes[app1], r.bytes[app1 + 1]]).toEqual([0xff, 0xe1]);
    expect(((r.bytes[app1 + 2] << 8) | r.bytes[app1 + 3]) - 2).toBe(6 + 26);
  });

  it("drops the ICC profile on request", async () => {
    const r = stripJpeg(dirty, DROP);
    expect(r.removed.map((x) => x.kind)).toContain("icc");
    expect(text(r.bytes)).not.toContain("ICC_PROFILE");
    expect((await readGroups(r.bytes)).icc).toBeUndefined();
  });

  it("writes no EXIF when orientation is normal", async () => {
    const r = stripJpeg(jpegWithMetadata(base, 1), DROP);
    expect(r.keptOrientation).toBe(false);
    expect(text(r.bytes)).not.toContain("Exif");
    expect(await readGroups(r.bytes)).toEqual({ jfif: expect.any(Object) });
  });

  it("returns a clean file untouched", () => {
    expect(stripJpeg(original, DROP).removed.map((x) => x.kind)).toEqual(["comment"]);
    expect(jpegScan(base)).toEqual(jpegScan(original));
    const r = stripJpeg(base, KEEP);
    expect(r.removed).toEqual([]);
    expect(r.bytes).toBe(base);
  });

  it("rejects corrupt input", () => {
    expect(() => stripJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), KEEP)).toThrow(/Corrupt/);
  });

  it("reports what was removed", async () => {
    const before = await readGroups(dirty);
    const after = await readGroups(stripJpeg(dirty, KEEP).bytes);
    const rep = removalReport(before, after);
    expect(rep).toMatchObject({ gps: true, camera: true, date: true });
    // everything except the kept Orientation, JFIF and ICC
    expect(rep.tags).toBe(countTags(before) - countTags(after));
    expect(rep.tags).toBeGreaterThan(15);
  });
});

describe("PNG", () => {
  const pixel = (x: number, y: number): [number, number, number, number] => [x * 60, y * 60, 128, 255];
  const clean = makePng(4, 4, pixel);
  const dirty = makePng(4, 4, pixel, pngMetadataChunks(6));

  it("drops text, time and EXIF chunks; keeps image chunks and a minimal eXIf", async () => {
    const r = stripPng(dirty, KEEP);
    expect(r.removed.map((x) => x.kind)).toEqual(["text", "text", "text", "xmp", "time", "exif"]);
    expect(pngChunks(r.bytes)).toEqual(["IHDR", "iCCP", "eXIf", "IDAT", "IEND"]);
    expect(r.keptOrientation).toBe(true);
    const g = await readGroups(r.bytes);
    expect(g.gps).toBeUndefined();
    expect(g.ifd0).toEqual({ Orientation: "Rotate 90 CW" });
    expect(g.ihdr?.Author).toBeUndefined();
    expect(text(r.bytes)).not.toContain("secret");
  });

  it("produces valid chunks (CRC) and identical pixel data", () => {
    const r = stripPng(dirty, DROP);
    expect(pngChunks(r.bytes)).toEqual(["IHDR", "eXIf", "IDAT", "IEND"]);
    const v = new DataView(r.bytes.buffer);
    for (let p = 8; p + 12 <= r.bytes.length; p += 12 + v.getUint32(p)) {
      const len = v.getUint32(p);
      expect(v.getUint32(p + 8 + len)).toBe(crc32(r.bytes.subarray(p + 4, p + 8 + len)));
    }
    // dropping the eXIf replacement and the ICC gives exactly the clean file
    expect(stripPng(makePng(4, 4, pixel, pngMetadataChunks(1)), DROP).bytes).toEqual(clean);
  });

  it("leaves a clean PNG alone", () => {
    expect(stripPng(clean, KEEP).removed).toEqual([]);
  });
});

describe("WebP", () => {
  const simple = fixture("photo.webp");
  const dirty = webpWithMetadata(simple, 6);

  it("drops EXIF/XMP, clears the VP8X flags and fixes the RIFF size", async () => {
    expect(riffChunks(dirty)).toEqual(["VP8X", "ICCP", "VP8 ", "EXIF", "XMP "]);
    const r = stripWebp(dirty, KEEP);
    expect(r.removed.map((x) => x.kind)).toEqual(["exif", "xmp"]);
    expect(riffChunks(r.bytes)).toEqual(["VP8X", "ICCP", "VP8 ", "EXIF"]);
    expect(r.bytes[20] & 0x3c).toBe(0x20 | 0x08); // ICC + EXIF (orientation), no XMP
    expect(new DataView(r.bytes.buffer).getUint32(4, true)).toBe(r.bytes.length - 8);

    const shell = webpAsJpegShell(r.bytes)!;
    const g = await readGroups(r.bytes);
    expect(shell).not.toBeNull();
    expect(g.ifd0).toEqual({ Orientation: "Rotate 90 CW" });
    expect(g.gps).toBeUndefined();
    expect(g.xmp).toBeUndefined();
  });

  it("clears every flag when nothing is kept", () => {
    const r = stripWebp(webpWithMetadata(simple, 1), DROP);
    expect(riffChunks(r.bytes)).toEqual(["VP8X", "VP8 "]);
    expect(r.bytes[20] & 0x3c).toBe(0);
    expect(r.bytes.subarray(r.bytes.length - (simple.length - 12))).toEqual(simple.subarray(12));
  });

  it("reads WebP metadata through the JPEG shell", async () => {
    const s = summarize(await readGroups(dirty));
    expect(s.camera).toBe("Canon EOS R5");
    expect(s.gps?.lat).toBeCloseTo(41.015, 3);
  });

  it("leaves a simple WebP alone", () => {
    expect(stripWebp(simple, DROP).bytes).toBe(simple);
  });
});
