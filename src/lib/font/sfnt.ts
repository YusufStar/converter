// Font sniffing, sfnt metadata (name / maxp / OS/2), character sets for subsetting and
// @font-face CSS. Pure functions, no dependencies.

export type FontKind = "ttf" | "otf" | "woff" | "woff2" | "eot" | "svg";
export type FontTarget = "ttf" | "woff" | "woff2" | "eot" | "svg";

export interface FontInfo {
  family: string;
  style: string;
  glyphs: number;
  /** OS/2 usWeightClass, 400 when missing. */
  weight: number;
  italic: boolean;
}

const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export function sniffFont(b: Uint8Array): FontKind | null {
  if (b.length < 12) return null;
  const t = tag(b, 0);
  if (t === "\0\u0001\0\0" || t === "true") return "ttf";
  if (t === "OTTO") return "otf";
  if (t === "wOFF") return "woff";
  if (t === "wOF2") return "woff2";
  if (b.length > 36 && b[34] === 0x4c && b[35] === 0x50) return "eot";
  const head = new TextDecoder().decode(b.subarray(0, 2048));
  if (/^﻿?\s*</.test(head) && /<svg[\s>]/.test(head) && /<font[\s>]/.test(new TextDecoder().decode(b.subarray(0, 65536)))) return "svg";
  return null;
}

/** True for CFF-flavoured sfnt (OpenType with PostScript outlines). */
export const isCff = (sfnt: Uint8Array) => tag(sfnt, 0) === "OTTO";

/** Table offsets of an uncompressed sfnt (TTF / OTF). */
export function sfntTables(b: Uint8Array): Map<string, { offset: number; length: number }> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint16(4);
  const out = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (o + 16 > b.length) break;
    out.set(tag(b, o), { offset: v.getUint32(o + 8), length: v.getUint32(o + 12) });
  }
  return out;
}

/** Family, style, glyph count, weight and italic flag from the name, maxp and OS/2 tables. */
export function sfntInfo(b: Uint8Array): FontInfo {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tables = sfntTables(b);
  const maxp = tables.get("maxp");
  const os2 = tables.get("OS/2");
  const names = readNames(b, tables.get("name"));
  const fsSelection = os2 && os2.length >= 64 ? v.getUint16(os2.offset + 62) : 0;
  return {
    family: names[16] ?? names[1] ?? "",
    style: names[17] ?? names[2] ?? "",
    glyphs: maxp ? v.getUint16(maxp.offset + 4) : 0,
    weight: os2 && os2.length >= 6 ? v.getUint16(os2.offset + 4) || 400 : 400,
    italic: (fsSelection & 0x201) !== 0,
  };
}

/** nameID → string, preferring Windows Unicode (English) records over Mac Roman ones. */
function readNames(b: Uint8Array, table?: { offset: number }): Record<number, string> {
  const out: Record<number, string> = {};
  if (!table) return out;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const base = table.offset;
  const count = v.getUint16(base + 2);
  const strings = base + v.getUint16(base + 4);
  const rank: Record<number, number> = {};
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const platform = v.getUint16(r);
    const lang = v.getUint16(r + 4);
    const id = v.getUint16(r + 6);
    const len = v.getUint16(r + 8);
    const off = strings + v.getUint16(r + 10);
    if (off + len > b.length) continue;
    const unicode = platform === 0 || platform === 3;
    const score = unicode ? (lang === 0x409 || platform === 0 ? 3 : 2) : platform === 1 && lang === 0 ? 1 : 0;
    if (!score || score <= (rank[id] ?? 0)) continue;
    const raw = b.subarray(off, off + len);
    out[id] = unicode ? new TextDecoder("utf-16be").decode(raw) : new TextDecoder("latin1").decode(raw);
    rank[id] = score;
  }
  return out;
}

// ---------- Subsetting ----------

export type Charset = "latin" | "latin-ext" | "turkish" | "custom";

type Range = [number, number];

// Same ranges Google Fonts serves for its "latin" and "latin-ext" slices.
const LATIN: Range[] = [
  [0x20, 0x7e], [0xa0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da], [0x2dc, 0x2dc],
  [0x304, 0x304], [0x308, 0x308], [0x329, 0x329], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191],
  [0x2193, 0x2193], [0x2212, 0x2212], [0x2215, 0x2215], [0xfeff, 0xfeff], [0xfffd, 0xfffd],
];
const LATIN_EXT: Range[] = [
  [0x100, 0x2ba], [0x2bd, 0x2c5], [0x2c7, 0x2cc], [0x2ce, 0x2d7], [0x2dd, 0x2ff], [0x1d00, 0x1dbf], [0x1e00, 0x1e9f], [0x1ef2, 0x1eff],
  [0x2020, 0x2020], [0x20a0, 0x20ab], [0x20ad, 0x20c0], [0x2113, 0x2113], [0x2c60, 0x2c7f], [0xa720, 0xa7ff],
];
// Basic Latin + Latin-1 punctuation + every Turkish letter (incl. â î û), quotes, dashes, € and ₺.
const TURKISH: Range[] = [
  [0x20, 0x7e], [0xa0, 0xbf], [0xc2, 0xc2], [0xc7, 0xc7], [0xce, 0xce], [0xd6, 0xd6], [0xdb, 0xdc], [0xe2, 0xe2], [0xe7, 0xe7],
  [0xee, 0xee], [0xf6, 0xf6], [0xfb, 0xfc], [0x11e, 0x11f], [0x130, 0x131], [0x15e, 0x15f], [0x2013, 0x2014], [0x2018, 0x201e],
  [0x2022, 0x2022], [0x2026, 0x2026], [0x20ac, 0x20ac], [0x20ba, 0x20ba],
];

/** Code points to keep. Custom text always keeps the space. */
export function charsetCodepoints(charset: Charset, custom = ""): number[] {
  if (charset === "custom") return [...new Set([0x20, ...Array.from(custom, (c) => c.codePointAt(0)!)])].sort((a, b) => a - b);
  const ranges = charset === "latin" ? LATIN : charset === "latin-ext" ? [...LATIN, ...LATIN_EXT] : TURKISH;
  const out = new Set<number>();
  for (const [a, z] of ranges) for (let c = a; c <= z; c++) out.add(c);
  return [...out].sort((a, b) => a - b);
}

/** Sorted code points → "U+20-7E, U+A0-FF" for @font-face unicode-range. */
export function unicodeRange(codepoints: number[]): string {
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  const parts: string[] = [];
  const hex = (n: number) => n.toString(16).toUpperCase();
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `U+${hex(sorted[i])}` : `U+${hex(sorted[i])}-${hex(sorted[j])}`);
    i = j;
  }
  return parts.join(", ");
}

// ---------- CSS ----------

const CSS_FORMAT: Record<FontTarget, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", eot: "embedded-opentype", svg: "svg" };

export interface FaceSource {
  file: string;
  target: FontTarget;
  info: FontInfo;
  /** Kept code points when the font was subset. */
  range?: number[];
}

/** One @font-face rule per file; files of one family share the family name. */
export function fontFaceCss(faces: FaceSource[]): string {
  return faces
    .map(({ file, target, info, range }) => {
      const url = encodeURI(file);
      const src = target === "eot" ? `url("${url}?#iefix")` : target === "svg" ? `url("${url}#${encodeURIComponent(info.family)}")` : `url("${url}")`;
      return [
        "@font-face {",
        `  font-family: "${info.family.replace(/"/g, '\\"') || "Custom Font"}";`,
        `  src: ${src} format("${CSS_FORMAT[target]}");`,
        `  font-weight: ${info.weight};`,
        `  font-style: ${info.italic ? "italic" : "normal"};`,
        "  font-display: swap;",
        ...(range?.length ? [`  unicode-range: ${unicodeRange(range)};`] : []),
        "}",
      ].join("\n");
    })
    .join("\n\n");
}
