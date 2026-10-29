import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matrixRotation, rotateMp4 } from "./mp4-rotate";

const clip = readFileSync(new URL("../../../e2e/fixtures/clip.mp4", import.meta.url));

/** [a, b, c, d] of the first video tkhd matrix (v0 header). */
async function matrixOf(blob: Blob): Promise<number[]> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(b.buffer);
  const tkhd = Buffer.from(b).indexOf("tkhd") - 4;
  const at = tkhd + 8 + 40;
  return [v.getInt32(at), v.getInt32(at + 4), v.getInt32(at + 12), v.getInt32(at + 16)];
}

describe("matrixRotation", () => {
  it("reads the four plain rotations and rejects flips", () => {
    const one = 0x10000;
    expect(matrixRotation(one, 0, 0, one)).toBe(0);
    expect(matrixRotation(0, one, -one, 0)).toBe(90);
    expect(matrixRotation(-one, 0, 0, -one)).toBe(180);
    expect(matrixRotation(0, -one, one, 0)).toBe(270);
    expect(matrixRotation(-one, 0, 0, one)).toBeNull(); // horizontal flip
  });
});

describe("rotateMp4", () => {
  it("rewrites only the display matrix", async () => {
    const r = await rotateMp4(new Blob([clip]), 90);
    expect(r?.rotation).toBe(90);
    expect(r!.blob.size).toBe(clip.length);
    expect(await matrixOf(r!.blob)).toEqual([0, 0x10000, -0x10000, 0]);
    // Every byte outside the matrix is unchanged.
    const out = new Uint8Array(await r!.blob.arrayBuffer());
    const diff = out.reduce((n, b, i) => n + (b !== clip[i] ? 1 : 0), 0);
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThanOrEqual(36);
  });

  it("adds to an existing rotation", async () => {
    const a = await rotateMp4(new Blob([clip]), 270);
    const b = await rotateMp4(a!.blob, 180);
    expect(b?.rotation).toBe(90);
    const c = await rotateMp4(b!.blob, 270);
    expect(c?.rotation).toBe(0);
    expect(await matrixOf(c!.blob)).toEqual([0x10000, 0, 0, 0x10000]);
  });

  it("returns null for files without a moov box", async () => {
    expect(await rotateMp4(new Blob([new Uint8Array(64)]), 90)).toBeNull();
    expect(await rotateMp4(new Blob([readFileSync(new URL("../../../e2e/fixtures/tone.wav", import.meta.url))]), 90)).toBeNull();
  });
});
