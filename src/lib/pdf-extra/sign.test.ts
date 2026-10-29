import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { ASCENT, DESCENT, inkBounds, initialsOf, removePaper, signPdf, type Placement } from "./sign";

const root = new URL("../../../", import.meta.url);
const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`e2e/fixtures/${name}`, root)));
const dejavu = async () => new Uint8Array(await readFile(new URL("node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", root)));

// 2×1 PNG: one opaque red pixel, one transparent.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGBgAI+AD/cESd6sAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

type M = number[];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Where pdf.js shows the page's images and text, in viewport pixels (scale 1, top-left origin). */
async function rendered(bytes: Uint8Array, pageNo: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const toView = (x: number, y: number) => vp.convertToViewportPoint(x, y) as [number, number];
  const ops = await page.getOperatorList();
  const images: { left: number; top: number; right: number; bottom: number }[] = [];
  const stack: M[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === pdfjs.OPS.transform) ctm = mul(Array.from(args as number[]), ctm);
    else if (fn === pdfjs.OPS.paintImageXObject) {
      const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)].map(([x, y]) => toView(x, y));
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      images.push({ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
    }
  });
  const text = (await page.getTextContent()).items.flatMap((it) => ("str" in it && it.str.trim() ? [{ str: it.str, at: toView(it.transform[4], it.transform[5]) }] : []));
  return { width: vp.width, height: vp.height, images, text };
}

describe("signPdf", () => {
  it("lands images and text where they were placed, on plain and rotated + cropped pages", async () => {
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const placements: Placement[] = [
      { id: "a", page: 0, kind: "image", image: "sig", ...box },
      { id: "b", page: 1, kind: "image", image: "sig", ...box },
      { id: "c", page: 1, kind: "text", text: "29.10.2026 İş", color: "#1d4ed8", x: 0.5, y: 0.7, w: 0.2, h: 0.05 },
    ];
    const out = await signPdf(await fixture("pdf-extra-sign.pdf"), placements, { sig: PNG }, dejavu);
    for (const n of [1, 2]) {
      const r = await rendered(out, n);
      expect(r.images).toHaveLength(1);
      const img = r.images[0];
      expect(img.left).toBeCloseTo(box.x * r.width, 3);
      expect(img.top).toBeCloseTo(box.y * r.height, 3);
      expect(img.right).toBeCloseTo((box.x + box.w) * r.width, 3);
      expect(img.bottom).toBeCloseTo((box.y + box.h) * r.height, 3);
    }
    // Page 2 shows its 800×540 crop box turned 90°; the text baseline sits one ascent below the box top.
    const r = await rendered(out, 2);
    expect([r.width, r.height]).toEqual([540, 800]);
    const stamp = r.text.find((t) => t.str.includes("İş"));
    const size = (0.05 * r.height) / (ASCENT + DESCENT);
    expect(stamp?.at[0]).toBeCloseTo(0.5 * r.width, 3);
    expect(stamp?.at[1]).toBeCloseTo(0.7 * r.height + ASCENT * size, 3);
  });

  it("embeds a reused image once", async () => {
    const placements: Placement[] = [0, 1].map((page) => ({ id: String(page), page, kind: "image", image: "sig", x: 0, y: 0, w: 0.2, h: 0.1 }));
    const doc = await PDFDocument.load(await signPdf(await fixture("pdf-extra-sign.pdf"), placements, { sig: PNG }, dejavu));
    const refs = doc.getPages().map((p) => {
      const xobjects = p.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
      return xobjects?.values().map(String) ?? [];
    });
    expect(refs[0]).toHaveLength(1);
    expect(refs[1]).toEqual(refs[0]);
  });

  it("refuses an empty placement list", async () => {
    await expect(signPdf(await fixture("pdf-extra-sign.pdf"), [], {}, dejavu)).rejects.toThrow("Place at least one item");
  });

  it("uses DejaVu's real vertical metrics", async () => {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const font = fontkit.create(await dejavu());
    expect(font.ascent / font.unitsPerEm).toBeCloseTo(ASCENT, 6);
    expect(-font.descent / font.unitsPerEm).toBeCloseTo(DESCENT, 6);
  });
});

describe("signature image helpers", () => {
  it("finds the ink bounding box", () => {
    const w = 5;
    const h = 4;
    const px = new Uint8ClampedArray(w * h * 4);
    px[(1 * w + 2) * 4 + 3] = 255;
    px[(3 * w + 4) * 4 + 3] = 255;
    expect(inkBounds(px, w, h)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
    expect(inkBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });

  it("clears grey paper but keeps dark and coloured ink", () => {
    const pixels = [
      ...Array.from({ length: 6 }, () => [222, 220, 215]), // photographed paper
      [20, 20, 20], // black ink
      [30, 60, 200], // blue ink
      [170, 168, 165], // anti-aliased edge
    ];
    const rgba = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
    removePaper(rgba);
    const alpha = Array.from({ length: pixels.length }, (_, i) => rgba[i * 4 + 3]);
    expect(alpha.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(alpha[6]).toBe(255);
    expect(alpha[7]).toBe(255);
    expect(alpha[8]).toBeGreaterThan(0);
    expect(alpha[8]).toBeLessThan(255);
  });

  it("makes initials", () => {
    expect(initialsOf("  Ada   Lovelace ")).toBe("AL");
    expect(initialsOf("şule")).toBe("Ş");
    expect(initialsOf("")).toBe("");
  });
});
