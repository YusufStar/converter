// Flow-layout PDF writer on pdf-lib: HTML → blocks → line/row fragments →
// pages. Fonts are embedded DejaVu subsets, so Turkish and most Unicode text
// renders correctly and stays selectable/searchable.
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from "pdf-lib";
import sans from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import sansB from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import sansI from "dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf?url";
import sansBI from "dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf?url";
import mono from "dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url";
import monoB from "dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url";
import monoI from "dejavu-fonts-ttf/ttf/DejaVuSansMono-Oblique.ttf?url";
import monoBI from "dejavu-fonts-ttf/ttf/DejaVuSansMono-BoldOblique.ttf?url";
import { PAGE_SIZES } from "../pdf/images-to-pdf";
import { baseStyle, expandTabs, htmlToBlocks, MUTED, type Bar, type Block, type RGB, type TextBlock, type TextStyle } from "./blocks";
import { breakLines, columnWidths, measureRuns, type Line, type Measure } from "./layout";

export type FontKey = "sans" | "sansB" | "sansI" | "sansBI" | "mono" | "monoB" | "monoI" | "monoBI";

export const FONT_FILES: Record<FontKey, string> = {
  sans: "DejaVuSans.ttf",
  sansB: "DejaVuSans-Bold.ttf",
  sansI: "DejaVuSans-Oblique.ttf",
  sansBI: "DejaVuSans-BoldOblique.ttf",
  mono: "DejaVuSansMono.ttf",
  monoB: "DejaVuSansMono-Bold.ttf",
  monoI: "DejaVuSansMono-Oblique.ttf",
  monoBI: "DejaVuSansMono-BoldOblique.ttf",
};
const FONT_URLS: Record<FontKey, string> = { sans, sansB, sansI, sansBI, mono, monoB, monoI, monoBI };

/** Supplies font bytes; tests inject a file reader, the app fetches the bundled files. */
export type FontLoader = (key: FontKey) => Promise<ArrayBuffer | Uint8Array>;

const fontCache = new Map<FontKey, Promise<ArrayBuffer>>();

/** Downloads a bundled font once per session, only when a PDF needs that face. */
export const fetchFont: FontLoader = (key) => {
  let p = fontCache.get(key);
  if (!p) {
    p = fetch(FONT_URLS[key]).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the ${FONT_FILES[key]} font`);
      return r.arrayBuffer();
    });
    p.catch(() => fontCache.delete(key));
    fontCache.set(key, p);
  }
  return p;
};

const fontKey = (st: Pick<TextStyle, "mono" | "bold" | "italic">) => `${st.mono ? "mono" : "sans"}${st.bold ? "B" : ""}${st.italic ? "I" : ""}` as FontKey;

export type PageSize = "a4" | "letter" | "legal";
export type Margins = "narrow" | "normal" | "wide";

export interface PdfOptions {
  pageSize: PageSize;
  margins: Margins;
  /** Body text size in points. */
  fontSize: number;
  pageNumbers: boolean;
  /** Printed at the top of the first page and stored as the PDF title when set. */
  title: string;
  underlineLinks: boolean;
}

export const DEFAULT_PDF: PdfOptions = { pageSize: "a4", margins: "normal", fontSize: 11, pageNumbers: true, title: "", underlineLinks: true };

export const MARGIN_PT: Record<Margins, number> = { narrow: 36, normal: 64, wide: 96 };

export interface PdfResult {
  bytes: Uint8Array;
  pages: number;
}

/** Converts an HTML document or fragment into a paginated PDF. */
export async function htmlToPdf(html: string, o: PdfOptions, loadFont: FontLoader = fetchFont): Promise<PdfResult> {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const blocks = htmlToBlocks(dom.body, { size: o.fontSize, underlineLinks: o.underlineLinks });
  const title = o.title.trim() || dom.title.trim() || dom.querySelector("h1")?.textContent?.trim() || "";
  return render(blocks, o, title, loadFont);
}

/** Plain text → PDF: line breaks and indentation are kept, long lines wrap. */
export async function textToPdf(text: string, o: PdfOptions & { font: "sans" | "mono" }, loadFont: FontLoader = fetchFont): Promise<PdfResult> {
  const clean = expandTabs(text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""));
  const block: TextBlock = {
    kind: "text",
    runs: [{ text: clean, st: { ...baseStyle(o.fontSize), mono: o.font === "mono" } }],
    size: o.fontSize,
    lh: 1.4,
    left: 0,
    bars: [],
    before: 0,
    after: 0,
  };
  return render(clean.trim() ? [block] : [], o, o.title.trim(), loadFont);
}

// ── images ──────────────────────────────────────────────────────────────

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

function dataUrlBytes(src: string): Uint8Array | null {
  const m = /^data:[^,]*?(;base64)?,(.*)$/is.exec(src);
  if (!m) return null;
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
  const bin = atob(m[2].replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** GIF, WebP, SVG, BMP… → PNG through the browser's decoder (unavailable in Node). */
async function rasterize(src: string): Promise<Uint8Array | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const img = new Image();
  img.src = src;
  await img.decode();
  const w = img.naturalWidth || 300;
  const h = img.naturalHeight || 150;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Only images carried inside the document (data: URLs) are used; nothing is fetched from the network. */
async function embedImage(doc: PDFDocument, src: string): Promise<PDFImage | null> {
  try {
    let bytes = dataUrlBytes(src);
    if (!bytes) return null;
    if (!isPng(bytes) && !isJpeg(bytes)) bytes = await rasterize(src);
    if (!bytes) return null;
    return isPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

// ── layout + paint ─────────────────────────────────────────────────────

/** An unbreakable slice of the flow: one text line, a table row, an image… */
interface Frag {
  h: number;
  /** Gap above; dropped at the top of a page. */
  before: number;
  bars: Bar[];
  /** Keep on the same page as the next fragment (heading lines). */
  keep?: boolean;
  /** Table header row to repeat when this row starts a new page. */
  head?: Frag;
  draw(page: PDFPage, x: number, top: number): void;
}

// DejaVu ascent/descent as a fraction of the font size.
const ASC = 0.928;
const DESC = 0.236;
const BOX: RGB = [0.955, 0.96, 0.968];
const CODE_BG: RGB = [0.93, 0.94, 0.955];
const GRID: RGB = [0.78, 0.8, 0.83];
const HEAD_BG: RGB = [0.94, 0.95, 0.965];
const BAR: RGB = [0.82, 0.84, 0.87];

type Walk = (bs: Block[]) => void;
function eachBlock(blocks: Block[], fn: (b: Block) => void) {
  const walk: Walk = (bs) => {
    for (const b of bs) {
      fn(b);
      if (b.kind === "table") for (const r of b.rows) for (const c of r.cells) walk(c.blocks);
    }
  };
  walk(blocks);
}

async function render(input: Block[], o: PdfOptions, title: string, loadFont: FontLoader): Promise<PdfResult> {
  const [{ PDFDocument, PDFString, rgb }, { default: fontkit }] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const size = o.fontSize;
  const color = (v: RGB) => rgb(v[0], v[1], v[2]);

  let blocks = input;
  const heading = o.title.trim();
  if (heading) {
    const ts = size * 2.1;
    const titleBlock: TextBlock = { kind: "text", runs: [{ text: heading, st: { ...baseStyle(ts), bold: true } }], size: ts, lh: 1.2, left: 0, bars: [], before: 0, after: size * 1.3, keep: true };
    blocks = [titleBlock, ...blocks];
  }

  const images = new Map<string, PDFImage>();
  const srcs = new Set<string>();
  eachBlock(blocks, (b) => b.kind === "image" && srcs.add(b.src));
  await Promise.all(
    [...srcs].map(async (src) => {
      const img = await embedImage(doc, src);
      if (img) images.set(src, img);
    }),
  );

  // Embed only the faces this document uses.
  const keys = new Set<FontKey>(["sans"]);
  eachBlock(blocks, (b) => {
    if (b.kind === "text") {
      for (const r of b.runs) keys.add(fontKey(r.st));
      if (b.marker) keys.add(fontKey(b.marker.st));
    } else if (b.kind === "image" && !images.has(b.src) && b.alt.trim()) keys.add("sansI");
  });
  const fonts = {} as Record<FontKey, PDFFont>;
  await Promise.all(
    [...keys].map(async (k) => {
      const bytes = await loadFont(k);
      // Ligatures off: every glyph maps back to its own character for copy/search.
      fonts[k] = await doc.embedFont(bytes, { subset: true, features: { liga: false } });
    }),
  );

  const widths = new Map<string, number>();
  const measure: Measure<TextStyle> = (text, st) => {
    const k = fontKey(st);
    const id = `${k}\u0001${text}`;
    let w = widths.get(id);
    if (w === undefined) {
      w = fonts[k].widthOfTextAtSize(text, 1000) / 1000;
      widths.set(id, w);
    }
    return w * st.size;
  };

  const [pw, ph] = PAGE_SIZES[o.pageSize];
  const m = MARGIN_PT[o.margins];
  const flowW = pw - 2 * m;
  const contentH = ph - 2 * m;
  const Y = (top: number) => ph - top;
  const PAD = size * 0.65;

  const link = (page: PDFPage, x: number, y: number, w: number, h: number, href: string) => {
    const annot = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
    });
    page.node.addAnnot(doc.context.register(annot));
  };

  const drawLine = (page: PDFPage, line: Line<TextStyle>, x: number, base: number) => {
    for (const s of line.segs) {
      if (s.st.code && s.text.trim()) {
        page.drawRectangle({ x: x + s.x - 1.5, y: Y(base - s.st.rise + s.st.size * 0.3), width: s.w + 3, height: s.st.size * 1.25, color: color(CODE_BG) });
      }
    }
    for (const s of line.segs) {
      const sx = x + s.x;
      const by = base - s.st.rise;
      const fs = s.st.size;
      if (s.text.trim()) page.drawText(s.text, { x: sx, y: Y(by), size: fs, font: fonts[fontKey(s.st)], color: color(s.st.color) });
      const rule = (dy: number) =>
        page.drawLine({ start: { x: sx, y: Y(by + dy) }, end: { x: sx + s.w, y: Y(by + dy) }, thickness: Math.max(0.5, fs * 0.06), color: color(s.st.color) });
      if (s.st.underline) rule(fs * 0.13);
      if (s.st.strike) rule(-fs * 0.3);
      if (s.st.href) link(page, sx, Y(by + fs * 0.25), s.w, fs * 1.2, s.st.href);
    }
  };

  const textFrags = (b: TextBlock, bw: number, out: Frag[]) => {
    const padX = b.box ? PAD : 0;
    const lines = breakLines(b.runs, bw - 2 * padX, measure);
    lines.forEach((line, i) => {
      const fs = Math.max(b.size, ...line.segs.map((s) => s.st.size));
      const lh = fs * b.lh;
      const padTop = b.box && i === 0 ? PAD * 0.75 : 0;
      const h = lh + padTop + (b.box && i === lines.length - 1 ? PAD * 0.75 : 0);
      out.push({
        h,
        before: 0,
        bars: b.bars,
        keep: b.keep,
        draw: (page, x0, top) => {
          const x = x0 + b.left;
          if (b.box) page.drawRectangle({ x, y: Y(top + h), width: bw, height: h, color: color(BOX) });
          const base = top + padTop + (lh - fs * (ASC + DESC)) / 2 + fs * ASC;
          const mk = i === 0 ? b.marker : undefined;
          if (mk) {
            const mw = measure(mk.text, mk.st);
            page.drawText(mk.text, { x: x - mw - size * 0.5, y: Y(base), size: mk.st.size, font: fonts[fontKey(mk.st)], color: color(mk.st.color) });
          }
          drawLine(page, line, x + padX, base);
        },
      });
    });
  };

  const stackHeight = (fs: Frag[]) => fs.reduce((a, f, k) => a + f.h + (k ? f.before : 0), 0);

  const minMax = (bs: Block[]): { min: number; max: number } => {
    let min = 0;
    let max = 0;
    for (const b of bs) {
      let r = { min: 0, max: 0 };
      if (b.kind === "text") {
        r = measureRuns(b.runs, measure);
        if (b.box) r = { min: r.min + 2 * PAD, max: r.max + 2 * PAD };
      } else if (b.kind === "image") {
        const img = images.get(b.src);
        const w = img ? (b.width ?? img.width) * 0.75 : 0;
        r = { min: Math.min(w, 60), max: w };
      } else if (b.kind === "table") {
        for (const row of b.rows) {
          const ms = row.cells.map((c) => minMax(c.blocks));
          const pad = ms.length * size;
          r.min = Math.max(r.min, ms.reduce((a, x) => a + x.min, pad));
          r.max = Math.max(r.max, ms.reduce((a, x) => a + x.max, pad));
        }
      }
      min = Math.max(min, r.min + b.left);
      max = Math.max(max, r.max + b.left);
    }
    return { min, max };
  };

  const tableFrags = (b: Extract<Block, { kind: "table" }>, bw: number, out: Frag[]) => {
    const padX = size * 0.5;
    const padY = size * 0.35;
    const ncol = Math.max(...b.rows.map((r) => r.cells.reduce((a, c) => a + c.span, 0)));
    const min = new Array<number>(ncol).fill(2 * padX);
    const max = new Array<number>(ncol).fill(2 * padX);
    for (const r of b.rows) {
      let col = 0;
      for (const cell of r.cells) {
        if (cell.span === 1) {
          const mm = minMax(cell.blocks);
          min[col] = Math.max(min[col], mm.min + 2 * padX);
          max[col] = Math.max(max[col], mm.max + 2 * padX);
        }
        col += cell.span;
      }
    }
    const ws = columnWidths(min, max, bw);
    const xs = [0];
    ws.forEach((w, i) => xs.push(xs[i] + w));
    let head: Frag | undefined;
    b.rows.forEach((r, ri) => {
      let col = 0;
      const cells = r.cells.map((cell) => {
        const span = Math.min(cell.span, ncol - col);
        const x = xs[col];
        const w = xs[col + span] - x;
        col += span;
        const frags = layout(cell.blocks, w - 2 * padX);
        return { x, w, frags, h: stackHeight(frags), head: cell.head || r.head };
      });
      const used = col;
      const rowH = Math.max(size * 1.35, ...cells.map((c) => c.h)) + 2 * padY;
      const frag: Frag = {
        h: rowH,
        before: 0,
        bars: b.bars,
        head: r.head ? undefined : head,
        draw: (page, x0, top) => {
          const x = x0 + b.left;
          const box = (cx: number, w: number, fill: boolean) =>
            page.drawRectangle({ x: x + cx, y: Y(top + rowH), width: w, height: rowH, borderColor: color(GRID), borderWidth: 0.6, ...(fill ? { color: color(HEAD_BG) } : {}) });
          for (const c of cells) {
            box(c.x, c.w, c.head);
            let y = top + padY;
            c.frags.forEach((f, k) => {
              if (k) y += f.before;
              f.draw(page, x + c.x + padX, y);
              y += f.h;
            });
          }
          for (let k = used; k < ncol; k++) box(xs[k], ws[k], false);
        },
      };
      if (r.head && ri === 0) head = frag;
      out.push(frag);
    });
  };

  function layout(bs: Block[], width: number): Frag[] {
    const out: Frag[] = [];
    let prevAfter = 0;
    for (const b of bs) {
      const start = out.length;
      const bw = Math.max(size * 0.5, width - b.left);
      if (b.kind === "text") textFrags(b, bw, out);
      else if (b.kind === "rule") {
        out.push({
          h: 1,
          before: 0,
          bars: b.bars,
          draw: (page, x0, top) => page.drawLine({ start: { x: x0 + b.left, y: Y(top + 0.5) }, end: { x: x0 + b.left + bw, y: Y(top + 0.5) }, thickness: 0.75, color: color(GRID) }),
        });
      } else if (b.kind === "image") {
        const img = images.get(b.src);
        if (!img) {
          const alt = b.alt.trim();
          if (alt) {
            const st: TextStyle = { ...baseStyle(size), italic: true, color: MUTED };
            textFrags({ kind: "text", runs: [{ text: `[${alt}]`, st }], size, lh: 1.45, left: b.left, bars: b.bars, before: 0, after: 0 }, bw, out);
          }
        } else {
          let w = (b.width ?? (b.height ? (b.height * img.width) / img.height : img.width)) * 0.75;
          let h = (b.height ?? (b.width ? (b.width * img.height) / img.width : img.height)) * 0.75;
          const f = Math.min(1, bw / w, contentH / h);
          w *= f;
          h *= f;
          out.push({ h, before: 0, bars: b.bars, draw: (page, x0, top) => page.drawImage(img, { x: x0 + b.left, y: Y(top + h), width: w, height: h }) });
        }
      } else tableFrags(b, bw, out);
      if (out.length > start) {
        out[start].before = Math.max(prevAfter, b.before);
        prevAfter = b.after;
      }
    }
    return out;
  }

  const frags = layout(blocks, flowW);

  // ── paginate ──
  const pages: PDFPage[] = [];
  let page = doc.addPage([pw, ph]);
  pages.push(page);
  let y = m;
  let atTop = true;
  const bars = new Map<number, { x: number; from: number }>();
  const closeBars = (keep: Bar[], at: number) => {
    for (const [id, bar] of bars) {
      if (keep.some((k) => k.id === id)) continue;
      if (at > bar.from) page.drawRectangle({ x: m + bar.x, y: Y(at), width: 2.5, height: at - bar.from, color: color(BAR) });
      bars.delete(id);
    }
  };
  const place = (f: Frag, gap: number) => {
    closeBars(f.bars, y);
    for (const b of f.bars) if (!bars.has(b.id)) bars.set(b.id, { x: b.x, from: y + gap });
    f.draw(page, m, y + gap);
    y += gap + f.h;
    atTop = false;
  };

  frags.forEach((f, i) => {
    let need = f.h;
    for (let j = i; frags[j].keep && j + 1 < frags.length; j++) need += frags[j + 1].before + frags[j + 1].h;
    if (need > contentH) need = f.h;
    if (!atTop && y + f.before + need > ph - m) {
      closeBars([], y);
      page = doc.addPage([pw, ph]);
      pages.push(page);
      y = m;
      atTop = true;
      if (f.head) place(f.head, 0);
    }
    place(f, atTop ? 0 : f.before);
  });
  closeBars([], y);

  if (o.pageNumbers) {
    const fs = Math.max(7, size * 0.75);
    pages.forEach((p, i) => {
      const t = `${i + 1} / ${pages.length}`;
      const w = fonts.sans.widthOfTextAtSize(t, fs);
      p.drawText(t, { x: (pw - w) / 2, y: Math.max(12, m / 2 - fs / 2), size: fs, font: fonts.sans, color: color(MUTED) });
    });
  }

  if (title) doc.setTitle(title);
  doc.setCreator("Converter");
  doc.setProducer("Converter (pdf-lib)");
  return { bytes: await doc.save(), pages: pages.length };
}
