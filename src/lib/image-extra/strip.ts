// Lossless metadata removal for JPEG, PNG and WebP: only metadata blocks are
// dropped, the compressed image data is copied byte for byte.

export type StripKind = "exif" | "xmp" | "iptc" | "comment" | "icc" | "text" | "time" | "extra" | "other";

export interface StripOptions {
  /** Keep the embedded ICC colour profile (colours shift without it). */
  keepIcc: boolean;
}

export interface StripResult {
  bytes: Uint8Array;
  /** Metadata blocks that were dropped, in file order. */
  removed: { kind: StripKind; bytes: number }[];
  /** EXIF orientation of the source (1 when absent). */
  orientation: number;
  /** A minimal EXIF block holding only the orientation was written back. */
  keptOrientation: boolean;
}

export type LosslessFormat = "jpeg" | "png" | "webp";

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const startsWith = (b: Uint8Array, s: string) => b.length >= s.length && ascii(b, 0, s.length) === s;

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Which of the losslessly strippable containers `b` is, by magic bytes. */
export function losslessFormat(b: Uint8Array): LosslessFormat | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return null;
}

// ── TIFF / EXIF ────────────────────────────────────────────────────────────

export const EXIF_PREFIX = "Exif\0\0";

/** EXIF payloads are a TIFF block, sometimes (PNG/WebP writers) still prefixed with "Exif\0\0". */
export function exifTiff(b: Uint8Array): Uint8Array {
  return startsWith(b, EXIF_PREFIX) ? b.subarray(6) : b;
}

/** Orientation (tag 0x0112) from IFD0 of a TIFF block, or 1. */
export function tiffOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const v = dv(tiff);
  const order = v.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const le = order === 0x4949;
  if (v.getUint16(2, le) !== 42) return 1;
  const ifd = v.getUint32(4, le);
  if (ifd + 2 > tiff.length) return 1;
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) break;
    if (v.getUint16(e, le) === 0x0112) {
      const o = v.getUint16(e + 8, le);
      return o >= 1 && o <= 8 ? o : 1;
    }
  }
  return 1;
}

/** A 26-byte big-endian TIFF whose only tag is Orientation. */
export function orientationTiff(o: number): Uint8Array {
  // prettier-ignore
  return new Uint8Array([
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8, // "MM", 42, IFD0 at 8
    0, 1, // one entry
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, // Orientation, SHORT, 1, value
    0, 0, 0, 0, // no next IFD
  ]);
}

// ── CRC-32 (PNG chunks) ────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── JPEG ───────────────────────────────────────────────────────────────────

/** Metadata kind of an APPn/COM segment, or null to keep it. */
function jpegKind(marker: number, body: Uint8Array): StripKind | null {
  if (marker === 0xfe) return "comment";
  if (marker === 0xe0) return startsWith(body, "JFIF\0") ? null : "other"; // JFXX thumbnails, AVI1…
  if (marker === 0xe1) {
    if (startsWith(body, "Exif\0")) return "exif";
    if (startsWith(body, "http://ns.adobe.com/")) return "xmp";
    return "other";
  }
  if (marker === 0xe2) return startsWith(body, "ICC_PROFILE\0") ? "icc" : "other"; // MPF, FlashPix
  if (marker === 0xed) return "iptc"; // Photoshop IRB with IPTC
  if (marker === 0xee) return startsWith(body, "Adobe") ? null : "other"; // Adobe = colour transform, needed to decode
  if (marker >= 0xe3 && marker <= 0xef) return "other";
  return null;
}

function jpegSegment(marker: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff;
  out[1] = marker;
  dv(out).setUint16(2, body.length + 2);
  out.set(body, 4);
  return out;
}

export function stripJpeg(src: Uint8Array, o: StripOptions): StripResult {
  if (losslessFormat(src) !== "jpeg") throw new Error("Not a JPEG file");
  const v = dv(src);
  const parts: Uint8Array[] = [src.subarray(0, 2)];
  const removed: StripResult["removed"] = [];
  let orientation = 0;
  let exifAt = 1; // parts index the orientation-only EXIF goes to (after SOI / JFIF)
  let p = 2;
  while (p + 1 < src.length) {
    if (src[p] !== 0xff) throw new Error("Corrupt JPEG (marker expected)");
    const m = src[p + 1];
    if (m === 0xff) {
      p++; // fill byte
      continue;
    }
    if (m === 0xd9) {
      parts.push(src.subarray(p, p + 2));
      p += 2;
      break; // EOI: anything after it (gain maps, MPF images, junk) is dropped
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      parts.push(src.subarray(p, p + 2));
      p += 2;
      continue;
    }
    if (p + 4 > src.length) throw new Error("Corrupt JPEG (truncated)");
    const end = p + 2 + v.getUint16(p + 2);
    if (end > src.length) throw new Error("Corrupt JPEG (truncated)");
    const kind = jpegKind(m, src.subarray(p + 4, end));
    if (kind === "exif" && !orientation) orientation = tiffOrientation(src.subarray(p + 10, end));
    if (kind && !(kind === "icc" && o.keepIcc)) {
      removed.push({ kind, bytes: end - p });
    } else {
      parts.push(src.subarray(p, end));
      if (m === 0xe0 && exifAt === parts.length - 1) exifAt = parts.length;
    }
    p = end;
    if (m === 0xda) {
      // Entropy-coded data runs until a marker that isn't stuffing (FF00) or a restart (FFD0–D7).
      let q = p;
      while (q + 1 < src.length && !(src[q] === 0xff && src[q + 1] !== 0 && (src[q + 1] < 0xd0 || src[q + 1] > 0xd7))) q++;
      if (q + 1 >= src.length) q = src.length;
      parts.push(src.subarray(p, q));
      p = q;
    }
  }
  if (p < src.length) removed.push({ kind: "extra", bytes: src.length - p });
  orientation ||= 1;
  if (!removed.length) return { bytes: src, removed, orientation, keptOrientation: false };
  const keptOrientation = orientation !== 1;
  if (keptOrientation) {
    parts.splice(exifAt, 0, jpegSegment(0xe1, concat([new TextEncoder().encode(EXIF_PREFIX), orientationTiff(orientation)])));
  }
  return { bytes: concat(parts), removed, orientation, keptOrientation };
}

// ── PNG ────────────────────────────────────────────────────────────────────

const PNG_DROP: Record<string, StripKind> = { tEXt: "text", zTXt: "text", iTXt: "text", eXIf: "exif", tIME: "time" };

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = dv(out);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function stripPng(src: Uint8Array, o: StripOptions): StripResult {
  if (losslessFormat(src) !== "png") throw new Error("Not a PNG file");
  const v = dv(src);
  const parts: Uint8Array[] = [src.subarray(0, 8)];
  const removed: StripResult["removed"] = [];
  let orientation = 1;
  let keptOrientation = false;
  let p = 8;
  while (p + 12 <= src.length) {
    const type = ascii(src, p + 4, 4);
    const end = p + 12 + v.getUint32(p);
    if (end > src.length) throw new Error("Corrupt PNG (truncated chunk)");
    const data = src.subarray(p + 8, end - 4);
    let kind: StripKind | null = PNG_DROP[type] ?? (type === "iCCP" && !o.keepIcc ? "icc" : null);
    if (type === "iTXt" && startsWith(data, "XML:com.adobe.xmp\0")) kind = "xmp";
    if (kind) {
      removed.push({ kind, bytes: end - p });
      if (type === "eXIf") {
        orientation = tiffOrientation(exifTiff(data));
        if (orientation !== 1) {
          parts.push(pngChunk("eXIf", orientationTiff(orientation)));
          keptOrientation = true;
        }
      }
    } else parts.push(src.subarray(p, end));
    p = end;
    if (type === "IEND") break;
  }
  if (p < src.length) removed.push({ kind: "extra", bytes: src.length - p });
  if (!removed.length) return { bytes: src, removed, orientation, keptOrientation };
  return { bytes: concat(parts), removed, orientation, keptOrientation };
}

// ── WebP ───────────────────────────────────────────────────────────────────

export function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1));
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  dv(out).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

// VP8X feature flags
const F_ICC = 0x20;
const F_EXIF = 0x08;
const F_XMP = 0x04;

export function stripWebp(src: Uint8Array, o: StripOptions): StripResult {
  if (losslessFormat(src) !== "webp") throw new Error("Not a WebP file");
  const v = dv(src);
  const riffEnd = Math.min(src.length, 8 + v.getUint32(4, true));
  const chunks: Uint8Array[] = [];
  const removed: StripResult["removed"] = [];
  let orientation = 1;
  let p = 12;
  while (p + 8 <= riffEnd) {
    const type = ascii(src, p, 4);
    const size = v.getUint32(p + 4, true);
    if (p + 8 + size > riffEnd) throw new Error("Corrupt WebP (truncated chunk)");
    const end = Math.min(riffEnd, p + 8 + size + (size & 1));
    const kind: StripKind | null = type === "EXIF" ? "exif" : type === "XMP " ? "xmp" : type === "ICCP" && !o.keepIcc ? "icc" : null;
    if (kind) {
      removed.push({ kind, bytes: end - p });
      if (kind === "exif") orientation = tiffOrientation(exifTiff(src.subarray(p + 8, p + 8 + size)));
    } else chunks.push(src.subarray(p, end));
    p = end;
  }
  if (src.length > riffEnd) removed.push({ kind: "extra", bytes: src.length - riffEnd });
  if (!removed.length) return { bytes: src, removed, orientation, keptOrientation: false };

  const keptOrientation = orientation !== 1;
  if (keptOrientation) chunks.push(riffChunk("EXIF", orientationTiff(orientation)));
  const vp8x = chunks.findIndex((c) => ascii(c, 0, 4) === "VP8X");
  if (vp8x >= 0) {
    const c = chunks[vp8x].slice();
    let flags = c[8] & ~F_XMP;
    if (!keptOrientation) flags &= ~F_EXIF;
    if (removed.some((r) => r.kind === "icc")) flags &= ~F_ICC;
    c[8] = flags;
    chunks[vp8x] = c;
  }
  const out = concat([src.subarray(0, 12), ...chunks]);
  dv(out).setUint32(4, out.length - 8, true);
  return { bytes: out, removed, orientation, keptOrientation };
}

/** Strips metadata from a JPEG, PNG or WebP without touching the image data. */
export function stripMetadata(src: Uint8Array, o: StripOptions): StripResult {
  switch (losslessFormat(src)) {
    case "jpeg":
      return stripJpeg(src, o);
    case "png":
      return stripPng(src, o);
    case "webp":
      return stripWebp(src, o);
    default:
      throw new Error("Only JPEG, PNG and WebP can be cleaned losslessly");
  }
}
