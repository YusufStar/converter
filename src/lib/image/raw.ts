/**
 * Camera RAW fallback: the largest JPEG preview embedded in the file. Every RAW
 * format (TIFF-based DNG/CR2/NEF/ARW/ORF/RW2/PEF/SRW, Canon's ISO-BMFF CR3, Fuji RAF)
 * stores one, usually at full or near-full resolution, so a byte scan for JPEG
 * streams covers them all without per-vendor parsers.
 */

export interface Preview {
  bytes: Uint8Array;
  width: number;
  height: number;
}

// Baseline, extended and progressive DCT: what browsers decode. Lossless SOF3 is RAW sensor data.
const DECODABLE_SOF = new Set([0xc0, 0xc1, 0xc2]);

/** End offset of the JPEG stream starting at `start` (just after EOI), with its size, or null if it isn't one. */
export function jpegStream(b: Uint8Array, start: number): { end: number; width: number; height: number } | null {
  if (b[start] !== 0xff || b[start + 1] !== 0xd8) return null;
  let p = start + 2;
  let width = 0;
  let height = 0;
  while (p + 2 <= b.length) {
    if (b[p] !== 0xff) return null;
    const m = b[p + 1];
    if (m === 0xff) {
      p++; // fill byte
      continue;
    }
    if (m === 0xd9) return width && height ? { end: p + 2, width, height } : null;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      p += 2;
      continue;
    }
    if (p + 4 > b.length) return null;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (!DECODABLE_SOF.has(m)) return null;
      height = (b[p + 5] << 8) | b[p + 6];
      width = (b[p + 7] << 8) | b[p + 8];
    }
    p += 2 + len;
    if (m === 0xda) {
      if (!width || !height) return null;
      // Entropy-coded data runs until a marker that isn't a stuffed 0x00 or a restart marker.
      while (p + 1 < b.length && !(b[p] === 0xff && b[p + 1] !== 0 && (b[p + 1] < 0xd0 || b[p + 1] > 0xd7))) p++;
    }
  }
  return null;
}

/** The largest (by pixel count) browser-decodable JPEG inside `b`, or null. */
export function largestJpeg(b: Uint8Array): Preview | null {
  let best: Preview | null = null;
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
    const s = jpegStream(b, i);
    if (!s) continue;
    if (!best || s.width * s.height > best.width * best.height) best = { bytes: b.subarray(i, s.end), width: s.width, height: s.height };
    // A JPEG's own EXIF thumbnail sits inside it and is always smaller: skip past it.
    i = s.end - 1;
  }
  return best;
}

/**
 * EXIF orientation (1–8) from IFD0 of a TIFF-based RAW (also ORF "IIRO"/"IIRS" and
 * RW2 "IIU" headers), or 1. Embedded previews are stored unrotated.
 */
export function tiffOrientation(b: Uint8Array): number {
  if (b.length < 16) return 1;
  const little = b[0] === 0x49 && b[1] === 0x49;
  if (!little && !(b[0] === 0x4d && b[1] === 0x4d)) return 1;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ifd = v.getUint32(4, little);
  if (ifd + 2 > b.length) return 1;
  const n = v.getUint16(ifd, little);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) return 1;
    if (v.getUint16(e, little) === 0x0112) {
      const o = v.getUint16(e + 8, little);
      return o >= 1 && o <= 8 ? o : 1;
    }
  }
  return 1;
}
