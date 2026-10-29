import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fonteditor, { woff2 } from "fonteditor-core";
import { convertFont, inspectFont } from "./convert";
import { charsetCodepoints, fontFaceCss, sfntInfo, sfntTables, sniffFont, unicodeRange } from "./sfnt";

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "../../../e2e/fixtures", name)));
const magic = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 4));
await woff2.init();

const ttf = fixture("font-sample.ttf");
const otf = fixture("font-sample.otf");

describe("sfnt", () => {
  it("sniffs every font flavour and ignores other files", () => {
    expect(sniffFont(ttf)).toBe("ttf");
    expect(sniffFont(otf)).toBe("otf");
    expect(sniffFont(convertFont(ttf, { target: "woff" }).data)).toBe("woff");
    expect(sniffFont(convertFont(ttf, { target: "woff2" }).data)).toBe("woff2");
    expect(sniffFont(convertFont(ttf, { target: "eot" }).data)).toBe("eot");
    expect(sniffFont(convertFont(ttf, { target: "svg" }).data)).toBe("svg");
    expect(sniffFont(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>"))).toBeNull();
    expect(sniffFont(new Uint8Array(100))).toBeNull();
  });

  it("reads family, style, glyph count and weight", () => {
    expect(sfntInfo(ttf)).toEqual({ family: "DejaVu Sans", style: "Book", glyphs: 123, weight: 400, italic: false });
    expect(sfntInfo(otf)).toMatchObject({ family: "DejaVu Sans OT", style: "Book", glyphs: 123 });
  });

  it("builds character sets and compact unicode ranges", () => {
    const tr = charsetCodepoints("turkish");
    for (const ch of "ğüşıöçĞÜŞİÖÇâ₺") expect(tr).toContain(ch.codePointAt(0));
    expect(charsetCodepoints("latin")).not.toContain("ğ".codePointAt(0));
    expect(charsetCodepoints("latin-ext")).toContain("ğ".codePointAt(0));
    expect(charsetCodepoints("custom", "aba")).toEqual([0x20, 0x61, 0x62]);
    expect(unicodeRange([0x41, 0x20, 0x42, 0x43, 0x11f])).toBe("U+20, U+41-43, U+11F");
  });

  it("writes @font-face rules", () => {
    const css = fontFaceCss([
      { file: "My Font.woff2", target: "woff2", info: { family: "My Font", style: "Bold", glyphs: 1, weight: 700, italic: false }, range: [0x20, 0x21] },
      { file: "a.eot", target: "eot", info: { family: "A", style: "Italic", glyphs: 1, weight: 400, italic: true } },
    ]);
    expect(css).toContain('font-family: "My Font";\n  src: url("My%20Font.woff2") format("woff2");\n  font-weight: 700;');
    expect(css).toContain("unicode-range: U+20-21;");
    expect(css).toContain('src: url("a.eot?#iefix") format("embedded-opentype");\n  font-weight: 400;\n  font-style: italic;');
  });
});

describe("convert", () => {
  it("re-wraps TTF → WOFF2 → TTF without touching the tables", () => {
    const w2 = convertFont(ttf, { target: "woff2" });
    expect(magic(w2.data)).toBe("wOF2");
    expect(w2.after).toEqual(w2.before);
    const back = convertFont(w2.data, { target: "ttf" }).data;
    expect([...sfntTables(back).keys()]).toEqual([...sfntTables(ttf).keys()]);
    expect(sfntInfo(back)).toEqual(sfntInfo(ttf));
  });

  it("re-wraps TTF → WOFF → TTF byte for byte", () => {
    const woff = convertFont(ttf, { target: "woff" }).data;
    expect(magic(woff)).toBe("wOFF");
    expect(convertFont(woff, { target: "ttf" }).data).toEqual(ttf);
  });

  it("keeps CFF outlines in WOFF2 but converts them for TTF", () => {
    const w2 = convertFont(otf, { target: "woff2" }).data;
    expect(magic(woff2.decode(w2.buffer as ArrayBuffer))).toBe("OTTO");
    const asTtf = convertFont(otf, { target: "ttf" });
    expect([...asTtf.data.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
    expect(sfntTables(asTtf.data).has("glyf")).toBe(true);
    expect(asTtf.after).toMatchObject({ family: "DejaVu Sans OT", glyphs: 123 });
  });

  it("subsets to a character set and keeps composite glyphs intact", () => {
    const { data, before, after } = convertFont(ttf, { target: "ttf", subset: charsetCodepoints("custom", "Ağ") });
    expect(before.glyphs).toBe(123);
    expect(after.glyphs).toBeLessThan(10);
    const font = fonteditor.createFont(data.buffer as ArrayBuffer, { type: "ttf" }).get();
    const unicodes = font.glyf.flatMap((g) => g.unicode ?? []);
    expect(unicodes).toEqual(expect.arrayContaining([0x41, 0x11f, 0x20]));
    expect(unicodes).not.toContain(0x42);
    // ğ is drawn: either its own contours or components that survived the subset.
    const g = font.glyf.find((x) => x.unicode?.includes(0x11f)) as { contours?: unknown[]; glyfs?: { glyphIndex: number }[] };
    expect((g.contours?.length ?? 0) + (g.glyfs?.length ?? 0)).toBeGreaterThan(0);
    for (const c of g.glyfs ?? []) expect(c.glyphIndex).toBeLessThan(font.glyf.length);
  });

  it("subset fonts still encode to WOFF2 and EOT; SVG fonts round-trip", () => {
    const subset = charsetCodepoints("turkish");
    expect(magic(convertFont(otf, { target: "woff2", subset }).data)).toBe("wOF2");
    const eot = convertFont(ttf, { target: "eot", subset }).data;
    expect(sniffFont(eot)).toBe("eot");
    const svg = convertFont(ttf, { target: "svg" });
    expect(new TextDecoder().decode(svg.data)).toContain("<font");
    expect(inspectFont(svg.data).info.glyphs).toBeGreaterThan(100);
    expect(inspectFont(eot)).toMatchObject({ kind: "eot", info: { family: "DejaVu Sans" } });
    expect(inspectFont(eot).preview).toBeInstanceOf(Uint8Array);
  });

  it("refuses non-fonts and collections clearly", () => {
    expect(() => convertFont(new TextEncoder().encode("hello world, not a font"), { target: "ttf" })).toThrow(/Not a font file/);
    expect(() => convertFont(new TextEncoder().encode("ttcf\0\u0002\0\0\0\0\0\0\0\0"), { target: "ttf" })).toThrow(/collections/);
  });
});
