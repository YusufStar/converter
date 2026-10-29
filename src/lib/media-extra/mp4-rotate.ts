// Lossless MP4/MOV rotation: rewrites the video tracks' display matrix (tkhd) and leaves
// every media byte alone. Works on Blob slices, so even multi-GB files cost one moov read.

import type { Rotation } from "../media/args";

const FIXED = 0x10000; // 1.0 in 16.16

interface Box {
  type: string;
  start: number;
  /** Header length (8, or 16 with a 64-bit size). */
  header: number;
  end: number;
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Child boxes of bytes[from, to). */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = v.getUint32(p);
    let header = 8;
    if (size === 1) {
      if (p + 16 > to) break;
      size = Number(v.getBigUint64(p + 8));
      header = 16;
    } else if (size === 0) size = to - p;
    if (size < header || p + size > to) break;
    out.push({ type: fourcc(b, p + 4), start: p, header, end: p + size });
    p += size;
  }
  return out;
}

const child = (b: Uint8Array, box: Box, type: string) => boxes(b, box.start + box.header, box.end).find((c) => c.type === type);

/** Clockwise angle of a pure-rotation matrix (a b / c d), or null for flips, scales and odd angles. */
export function matrixRotation(a: number, b: number, c: number, d: number): Rotation | null {
  const r: Record<string, Rotation> = { "1,0,0,1": 0, "0,1,-1,0": 90, "-1,0,0,-1": 180, "0,-1,1,0": 270 };
  return r[[a, b, c, d].map((x) => Math.round(x / FIXED)).join(",")] ?? null;
}

/** tkhd matrix for a clockwise rotation of a `w`×`h` picture (same values ffmpeg and phones write). */
function matrix(rot: Rotation, w: number, h: number): number[] {
  const one = FIXED;
  const W = 0x40000000; // 1.0 in 2.30
  const m: Record<Rotation, [number, number, number, number, number, number]> = {
    0: [one, 0, 0, one, 0, 0],
    90: [0, one, -one, 0, h * one, 0],
    180: [-one, 0, 0, -one, w * one, h * one],
    270: [0, -one, one, 0, 0, w * one],
  };
  const [a, b, c, d, x, y] = m[rot];
  return [a, b, 0, c, d, 0, x, y, W];
}

/**
 * Turns every video track in a `moov` box by `by` degrees clockwise, in place.
 * Returns the new rotation, or null when there's no video track or a track's
 * matrix isn't a plain rotation (left untouched then).
 */
export function rotateMoov(moov: Uint8Array, by: Rotation): Rotation | null {
  const v = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const [root] = boxes(moov, 0, moov.length);
  if (root?.type !== "moov") return null;
  const edits: { at: number; values: number[] }[] = [];
  let result: Rotation | null = null;
  for (const trak of boxes(moov, root.header, root.end).filter((x) => x.type === "trak")) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = mdia && child(moov, mdia, "hdlr");
    if (!hdlr || fourcc(moov, hdlr.start + hdlr.header + 8) !== "vide") continue;
    const tkhd = child(moov, trak, "tkhd");
    if (!tkhd) return null;
    const body = tkhd.start + tkhd.header;
    // version/flags, times + track id + duration (64-bit times in v1), 8 reserved, layer/group/volume/reserved
    const at = body + (moov[body] === 1 ? 52 : 40);
    if (at + 44 > tkhd.end) return null;
    const cur = matrixRotation(v.getInt32(at), v.getInt32(at + 4), v.getInt32(at + 12), v.getInt32(at + 16));
    if (cur === null) return null;
    const next = ((cur + by) % 360) as Rotation;
    edits.push({ at, values: matrix(next, v.getUint32(at + 36) / FIXED, v.getUint32(at + 40) / FIXED) });
    result = next;
  }
  for (const e of edits) e.values.forEach((x, i) => v.setInt32(e.at + i * 4, x | 0));
  return result;
}

/** Top-level boxes of a Blob, reading 16-byte headers only. */
async function topLevel(file: Blob): Promise<Box[]> {
  const out: Box[] = [];
  let p = 0;
  while (p + 8 <= file.size) {
    const found = readHeader(new Uint8Array(await file.slice(p, p + 16).arrayBuffer()), p, file.size);
    if (!found) break;
    const box = { ...found, start: p, end: p + (found.end - found.start) };
    out.push(box);
    p = box.end;
  }
  return out;
}

/** Box from its first (up to) 16 bytes; the box itself may be far bigger. */
function readHeader(h: Uint8Array, at: number, fileSize: number): Box | null {
  const v = new DataView(h.buffer);
  let size = v.getUint32(0);
  let header = 8;
  if (size === 1) {
    if (h.length < 16) return null;
    size = Number(v.getBigUint64(8));
    header = 16;
  } else if (size === 0) size = fileSize - at;
  if (size < header || at + size > fileSize) return null;
  return { type: fourcc(h, 4), start: 0, header, end: size };
}

/**
 * Rotates an MP4/MOV by `by` degrees clockwise without re-encoding. Returns null when
 * the file can't be rotated this way (no moov / video track, or a flipped matrix).
 */
export async function rotateMp4(file: Blob, by: Rotation): Promise<{ blob: Blob; rotation: Rotation } | null> {
  const moov = (await topLevel(file)).find((b) => b.type === "moov");
  if (!moov) return null;
  const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
  const rotation = rotateMoov(bytes, by);
  if (rotation === null) return null;
  return { blob: new Blob([file.slice(0, moov.start), bytes, file.slice(moov.end)], { type: file.type || "video/mp4" }), rotation };
}
