/**
 * EXIF orientation (1–8) of a JPEG, or 1 when absent. Raw JPEG bytes embedded
 * in a PDF ignore EXIF, so anything other than 1 must be re-drawn first.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 4 < bytes.length) {
    if (bytes[p] !== 0xff) return 1;
    const marker = bytes[p + 1];
    const len = v.getUint16(p + 2);
    if (marker === 0xda) return 1; // start of scan: no more metadata
    // APP1 "Exif\0\0"
    if (marker === 0xe1 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {
      const tiff = p + 10;
      const little = v.getUint16(tiff) === 0x4949;
      const ifd = tiff + v.getUint32(tiff + 4, little);
      if (ifd + 2 > bytes.length) return 1;
      const entries = v.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > bytes.length) return 1;
        if (v.getUint16(e, little) === 0x0112) {
          const o = v.getUint16(e + 8, little);
          return o >= 1 && o <= 8 ? o : 1;
        }
      }
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}

/** Pixel size from a JPEG's SOF marker, or null. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 9 < bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: v.getUint16(p + 5), width: v.getUint16(p + 7) };
    }
    p += 2 + v.getUint16(p + 2);
  }
  return null;
}
