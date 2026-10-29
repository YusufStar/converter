// Font conversion with fonteditor-core. Container changes (TTF/OTF ↔ WOFF ↔ WOFF2, TTF → EOT)
// re-wrap the original tables untouched; only subsetting, CFF → TrueType and SVG fonts rebuild the
// font through fonteditor (which keeps glyphs, metrics, hinting and kerning but drops GSUB).
// Callers must have run woff2.init() first (see font.worker.ts).

import fonteditor, { woff2 } from "fonteditor-core";
import { unzlibSync, zlibSync } from "fflate";
import { isCff, sfntInfo, sniffFont, type FontInfo, type FontKind, type FontTarget } from "./sfnt";

export interface ConvertOptions {
  target: FontTarget;
  /** Code points to keep; omit to keep every glyph. */
  subset?: number[];
}

export interface ConvertResult {
  data: Uint8Array;
  before: FontInfo;
  after: FontInfo;
}

export interface Inspected {
  kind: FontKind;
  info: FontInfo;
  /** A TTF/OTF copy for the FontFace preview when the browser can't load the original (EOT, SVG). */
  preview?: Uint8Array;
}

const toAb = (u: Uint8Array): ArrayBuffer =>
  (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? u.buffer : u.slice().buffer) as ArrayBuffer;
const toU8 = (x: ArrayBuffer | Uint8Array | ArrayLike<number>) => (x instanceof Uint8Array ? x : new Uint8Array(x as ArrayBuffer));
const inflate = (d: ArrayLike<number>) => Array.from(unzlibSync(new Uint8Array(d)));
const deflate = (d: ArrayLike<number>) => Array.from(zlibSync(new Uint8Array(d), { level: 9 }));

function kindOf(bytes: Uint8Array): FontKind {
  const kind = sniffFont(bytes);
  if (kind) return kind;
  if (bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "ttcf") throw new Error("Font collections (.ttc) aren't supported — convert one font at a time.");
  throw new Error("Not a font file (TTF, OTF, WOFF, WOFF2, EOT or SVG font).");
}

/** Any supported font → uncompressed sfnt (TTF or OTF), losslessly where the format allows. */
function toSfnt(bytes: Uint8Array, kind: FontKind): Uint8Array {
  switch (kind) {
    case "ttf":
    case "otf":
      return bytes;
    case "woff":
      return toU8(fonteditor.woff2ttf(toAb(bytes), { inflate }));
    case "woff2": {
      const out = woff2.decode(toAb(bytes));
      if (!out.length) throw new Error("This WOFF2 file is damaged.");
      return out;
    }
    case "eot":
      return toU8(fonteditor.eot2ttf(toAb(bytes)));
    case "svg":
      return toU8(fonteditor.createFont(new TextDecoder().decode(bytes), { type: "svg" }).write({ type: "ttf", toBuffer: false }) as ArrayBuffer);
  }
}

export function inspectFont(bytes: Uint8Array): Inspected {
  const kind = kindOf(bytes);
  const sfnt = toSfnt(bytes, kind);
  return { kind, info: sfntInfo(sfnt), preview: kind === "eot" || kind === "svg" ? sfnt : undefined };
}

export function convertFont(bytes: Uint8Array, { target, subset }: ConvertOptions): ConvertResult {
  let sfnt = toSfnt(bytes, kindOf(bytes));
  const before = sfntInfo(sfnt);
  const cff = isCff(sfnt);

  if (subset || target === "svg" || (cff && (target === "ttf" || target === "eot"))) {
    // `hinting` also carries GPOS/kern over (passing `kerning` too would write them twice).
    const font = fonteditor.createFont(toAb(sfnt), { type: cff ? "otf" : "ttf", subset, hinting: true });
    const ttf = font.get() as unknown as Record<string, unknown> & { glyf: unknown[] };
    if (subset) {
      // Glyph ids change when subsetting, so the copied kerning tables would point at the wrong glyphs.
      delete ttf.GPOS;
      delete ttf.kern;
      delete ttf.kerx;
    }
    if (target === "svg") {
      const svg = font.write({ type: "svg", toBuffer: false }) as string;
      return { data: new TextEncoder().encode(svg), before, after: { ...before, glyphs: ttf.glyf.length } };
    }
    sfnt = toU8(font.write({ type: "ttf", hinting: true, toBuffer: false }) as ArrayBuffer);
  }

  const after = sfntInfo(sfnt);
  let data: Uint8Array;
  if (target === "ttf") data = sfnt;
  else if (target === "woff") data = toU8(fonteditor.ttf2woff(toAb(sfnt), { deflate, metadata: undefined }));
  else if (target === "eot") data = toU8(fonteditor.ttf2eot(toAb(sfnt)));
  else {
    data = woff2.encode(toAb(sfnt));
    if (!data.length) throw new Error("The WOFF2 encoder rejected this font.");
  }
  return { data, before, after };
}
