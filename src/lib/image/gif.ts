export interface Frame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Animated GIF from same-sized RGBA frames, each with its own 256-colour
 * palette (better colours than one global palette for photo slideshows).
 */
export async function makeAnimatedGif(frames: Frame[], { delay, loop }: { delay: number; loop: boolean }): Promise<Uint8Array> {
  if (!frames.length) throw new Error("No frames");
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const gif = GIFEncoder();
  const { width, height } = frames[0];
  frames.forEach((f, i) => {
    if (f.width !== width || f.height !== height) throw new Error("All frames must have the same size");
    const palette = quantize(f.data, 256);
    const index = applyPalette(f.data, palette);
    // repeat: 0 = loop forever, -1 = play once (only read from the first frame).
    gif.writeFrame(index, width, height, { palette, delay, ...(i === 0 ? { repeat: loop ? 0 : -1 } : {}) });
  });
  gif.finish();
  return gif.bytes();
}
