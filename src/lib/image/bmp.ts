/** 24-bit BMP from RGBA pixels (alpha is ignored — flatten onto a background first). */
export function encodeBmp(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const imageSize = rowSize * height;
  const fileSize = 54 + imageSize;
  const out = new Uint8Array(fileSize);
  const v = new DataView(out.buffer);
  // BITMAPFILEHEADER
  out[0] = 0x42; // B
  out[1] = 0x4d; // M
  v.setUint32(2, fileSize, true);
  v.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true); // positive = bottom-up rows
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, imageSize, true);
  v.setInt32(38, 2835, true); // 72 dpi
  v.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      out[dst++] = rgba[i + 2];
      out[dst++] = rgba[i + 1];
      out[dst++] = rgba[i];
    }
  }
  return out;
}
