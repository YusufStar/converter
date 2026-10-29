/** Standard favicon sizes; 256 is the largest an .ico entry can describe. */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

/** Packs PNG images into one .ico (PNG-compressed entries, supported since Windows Vista). */
export function encodeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const count = images.length;
  const headerSize = 6 + count * 16;
  const total = headerSize + images.reduce((a, im) => a + im.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, count, true);
  let offset = headerSize;
  images.forEach((im, i) => {
    const e = 6 + i * 16;
    out[e] = im.size >= 256 ? 0 : im.size; // 0 means 256
    out[e + 1] = im.size >= 256 ? 0 : im.size;
    out[e + 2] = 0; // palette colours
    out[e + 3] = 0;
    v.setUint16(e + 4, 1, true); // planes
    v.setUint16(e + 6, 32, true); // bits per pixel
    v.setUint32(e + 8, im.png.length, true);
    v.setUint32(e + 12, offset, true);
    out.set(im.png, offset);
    offset += im.png.length;
  });
  return out;
}
