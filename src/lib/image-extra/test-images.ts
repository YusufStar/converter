// Test-only builders for images carrying known metadata (unit tests + e2e
// fixture generation). Not imported by the app.
import { deflateSync } from "node:zlib";
import { EXIF_PREFIX, concat, pngChunk, riffChunk } from "./strip";

type Value = string | number[] | [number, number][];
/** [tag, TIFF type (2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL), value] */
export type Entry = [number, 2 | 3 | 4 | 5, Value];

const enc = new TextEncoder();

function valueBytes(type: Entry[1], value: Value): { bytes: Uint8Array; count: number } {
  if (type === 2) {
    const s = enc.encode(`${value as string}\0`);
    return { bytes: s, count: s.length };
  }
  if (type === 5) {
    const pairs = value as [number, number][];
    const b = new Uint8Array(pairs.length * 8);
    pairs.forEach(([n, d], i) => {
      new DataView(b.buffer).setUint32(i * 8, n);
      new DataView(b.buffer).setUint32(i * 8 + 4, d);
    });
    return { bytes: b, count: pairs.length };
  }
  const nums = value as number[];
  const size = type === 3 ? 2 : 4;
  const b = new Uint8Array(nums.length * size);
  nums.forEach((n, i) => (size === 2 ? new DataView(b.buffer).setUint16(i * 2, n) : new DataView(b.buffer).setUint32(i * 4, n)));
  return { bytes: b, count: nums.length };
}

function ifdSize(entries: Entry[]): number {
  return entries.reduce((a, [, t, v]) => {
    const n = valueBytes(t, v).bytes.length;
    return a + (n > 4 ? n + (n & 1) : 0);
  }, 6 + entries.length * 12);
}

function writeIfd(out: Uint8Array, at: number, entries: Entry[]) {
  const v = new DataView(out.buffer, out.byteOffset);
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  v.setUint16(at, sorted.length);
  let data = at + 6 + sorted.length * 12;
  sorted.forEach(([tag, type, value], i) => {
    const e = at + 2 + i * 12;
    const { bytes, count } = valueBytes(type, value);
    v.setUint16(e, tag);
    v.setUint16(e + 2, type);
    v.setUint32(e + 4, count);
    if (bytes.length <= 4) out.set(bytes, e + 8);
    else {
      v.setUint32(e + 8, data);
      out.set(bytes, data);
      data += bytes.length + (bytes.length & 1);
    }
  });
  v.setUint32(at + 2 + sorted.length * 12, 0);
}

/** Big-endian TIFF block with IFD0 and optional EXIF / GPS sub-IFDs. */
export function buildTiff(ifd0: Entry[], exif: Entry[] = [], gps: Entry[] = []): Uint8Array {
  const root: Entry[] = [...ifd0];
  if (exif.length) root.push([0x8769, 4, [0]]);
  if (gps.length) root.push([0x8825, 4, [0]]);
  const exifAt = 8 + ifdSize(root);
  const gpsAt = exifAt + (exif.length ? ifdSize(exif) : 0);
  const fixed = root.map<Entry>(([tag, t, v]) => (tag === 0x8769 ? [tag, t, [exifAt]] : tag === 0x8825 ? [tag, t, [gpsAt]] : [tag, t, v]));
  const out = new Uint8Array(gpsAt + (gps.length ? ifdSize(gps) : 0));
  out.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]);
  writeIfd(out, 8, fixed);
  if (exif.length) writeIfd(out, exifAt, exif);
  if (gps.length) writeIfd(out, gpsAt, gps);
  return out;
}

/** Camera + GPS (Istanbul, 41.015 N 28.975 E) + exposure tags with the given orientation. */
export function sampleTiff(orientation = 6): Uint8Array {
  return buildTiff(
    [
      [0x010f, 2, "Canon"],
      [0x0110, 2, "Canon EOS R5"],
      [0x0112, 3, [orientation]],
      [0x0131, 2, "Test Suite 1.0"],
      [0x0132, 2, "2024:05:01 10:00:00"],
      [0x013b, 2, "Jane Doe"],
    ],
    [
      [0x829a, 5, [[1, 250]]],
      [0x829d, 5, [[28, 10]]],
      [0x8827, 3, [400]],
      [0x9003, 2, "2024:05:01 10:00:00"],
      [0x920a, 5, [[50, 1]]],
      [0xa434, 2, "RF50mm F1.8 STM"],
    ],
    [
      [0x0001, 2, "N"],
      [0x0002, 5, [[41, 1], [0, 1], [5400, 100]]],
      [0x0003, 2, "E"],
      [0x0004, 5, [[28, 1], [58, 1], [3000, 100]]],
      [0x0006, 5, [[40, 1]]],
    ],
  );
}

export const SAMPLE_XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Test Suite"/></rdf:RDF></x:xmpmeta>';

/** Minimal valid ICC header (128 bytes + empty tag table). */
export function sampleIcc(): Uint8Array {
  const b = new Uint8Array(132);
  const v = new DataView(b.buffer);
  v.setUint32(0, 132);
  b.set(enc.encode("appl"), 4);
  v.setUint32(8, 0x02100000);
  b.set(enc.encode("mntrRGB XYZ "), 12);
  b.set(enc.encode("acsp"), 36);
  return b;
}

export function jpegSeg(marker: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff;
  out[1] = marker;
  new DataView(out.buffer).setUint16(2, body.length + 2);
  out.set(body, 4);
  return out;
}

function iptc(): Uint8Array {
  const record = concat([new Uint8Array([0x1c, 2, 0x50, 0, 8]), enc.encode("Jane Doe")]); // 2:80 By-line
  const res = new Uint8Array(12 + record.length + (record.length & 1));
  res.set(enc.encode("8BIM"));
  new DataView(res.buffer).setUint16(4, 0x0404);
  new DataView(res.buffer).setUint32(8, record.length);
  res.set(record, 12);
  return concat([enc.encode("Photoshop 3.0\0"), res]);
}

/** Inserts EXIF, XMP, IPTC, ICC, a comment and trailing bytes into a plain JPEG. */
export function jpegWithMetadata(base: Uint8Array, orientation = 6): Uint8Array {
  const jfifEnd = base[3] === 0xe0 ? 4 + ((base[4] << 8) | base[5]) : 2;
  const segs = [
    jpegSeg(0xe1, concat([enc.encode(EXIF_PREFIX), sampleTiff(orientation)])),
    jpegSeg(0xe1, concat([enc.encode("http://ns.adobe.com/xap/1.0/\0"), enc.encode(SAMPLE_XMP)])),
    jpegSeg(0xe2, concat([enc.encode("ICC_PROFILE\0"), new Uint8Array([1, 1]), sampleIcc()])),
    jpegSeg(0xed, iptc()),
    jpegSeg(0xfe, enc.encode("Shot on a test rig")),
  ];
  return concat([base.subarray(0, jfifEnd), ...segs, base.subarray(jfifEnd), enc.encode("TRAILING-GAIN-MAP")]);
}

/** RGBA PNG (filter 0) with extra chunks placed before IDAT. */
export function makePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number], extra: Uint8Array[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (1 + w * 4) + 1 + x * 4);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...extra,
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

export function pngMetadataChunks(orientation = 6): Uint8Array[] {
  return [
    pngChunk("iCCP", concat([enc.encode("sRGB\0\0"), new Uint8Array(deflateSync(sampleIcc()))])),
    pngChunk("tEXt", enc.encode("Author\0Jane Doe")),
    pngChunk("tEXt", enc.encode("Comment\0secret")),
    pngChunk("zTXt", concat([enc.encode("Description\0\0"), new Uint8Array(deflateSync(enc.encode("a long description")))])),
    pngChunk("iTXt", concat([enc.encode("XML:com.adobe.xmp\0\0\0\0\0"), enc.encode(SAMPLE_XMP)])),
    pngChunk("tIME", new Uint8Array([0x07, 0xe8, 5, 1, 10, 0, 0])),
    pngChunk("eXIf", sampleTiff(orientation)),
  ];
}

/** Wraps a simple (VP8) WebP into an extended VP8X file with ICC, EXIF and XMP chunks. */
export function webpWithMetadata(simple: Uint8Array, orientation = 6): Uint8Array {
  const vp8 = simple.subarray(12);
  const v = new DataView(simple.buffer, simple.byteOffset);
  const w = (v.getUint16(26, true) & 0x3fff) - 1;
  const h = (v.getUint16(28, true) & 0x3fff) - 1;
  const x = new Uint8Array(10);
  x[0] = 0x20 | 0x08 | 0x04;
  x.set([w & 0xff, (w >> 8) & 0xff, w >> 16, h & 0xff, (h >> 8) & 0xff, h >> 16], 4);
  const body = concat([
    enc.encode("WEBP"),
    riffChunk("VP8X", x),
    riffChunk("ICCP", sampleIcc()),
    vp8,
    riffChunk("EXIF", sampleTiff(orientation)),
    riffChunk("XMP ", enc.encode(SAMPLE_XMP)),
  ]);
  const out = concat([enc.encode("RIFF"), new Uint8Array(4), body]);
  new DataView(out.buffer).setUint32(4, body.length, true);
  return out;
}
