// Node environment (pdfjs needs it) with happy-dom's DOMParser for the HTML side.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Window } from "happy-dom";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PDF, FONT_FILES, htmlToPdf, textToPdf, type FontLoader, type PdfOptions } from "./html-to-pdf";

const FONT_DIR = join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf");
const loaded: string[] = [];
const loadFont: FontLoader = async (key) => {
  loaded.push(key);
  return readFile(join(FONT_DIR, FONT_FILES[key]));
};

// 1×1 red PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

beforeAll(() => {
  globalThis.DOMParser = new Window().DOMParser as unknown as typeof DOMParser;
});

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
  }
  return pages;
}

const opts = (p: Partial<PdfOptions> = {}): PdfOptions => ({ ...DEFAULT_PDF, ...p });

describe("textToPdf", () => {
  it("paginates exactly: 50 lines of 10pt×1.4 fit an A4 page with normal margins", async () => {
    // Content height 841.89 − 2×64 = 713.89pt; 14pt per line → 50 lines per page.
    const text = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join("\n");
    const r = await textToPdf(text, { ...opts({ fontSize: 10, pageNumbers: false }), font: "mono" }, loadFont);
    expect(r.pages).toBe(3);
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    const pages = await pdfText(r.bytes);
    expect(pages[0]).toContain("Line 50");
    expect(pages[0]).not.toContain("Line 51");
    expect(pages[2]).toContain("Line 120");
  });

  it("wraps long lines, keeps Turkish text selectable and honours page size", async () => {
    const long = "ğüşıöç ĞÜŞİÖÇ ".repeat(40);
    const r = await textToPdf(long, { ...opts({ pageSize: "letter", margins: "wide" }), font: "sans" }, loadFont);
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const [page] = await pdfText(r.bytes);
    expect(page).toContain("ğüşıöç ĞÜŞİÖÇ");
    expect(page).toContain("1 / 1");
  });
});

describe("htmlToPdf", () => {
  const section = (n: number) =>
    `<h2>Section ${n}</h2><p>Paragraph ${n} with <b>bold</b>, <i>italic</i>, <code>code()</code> and Turkish ğüşıöç. ${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6)}</p>`;
  const html = `<!doctype html><html><head><title>Quarterly Report</title></head><body>
    <h1>Quarterly Report</h1>
    <p>Visit <a href="https://example.com/">our site</a>.</p>
    <ul><li>Revenue up 12%</li><li>Two markets<ol><li>İzmir</li><li>Gaziantep</li></ol></li></ul>
    <blockquote><p>Quoted wisdom.</p></blockquote>
    <pre>const x = 1;\n  indented();</pre>
    <table><thead><tr><th>Region</th><th>Sales</th></tr></thead><tbody>
      ${Array.from({ length: 40 }, (_, i) => `<tr><td>Region ${i}</td><td>${i * 10}</td></tr>`).join("")}
    </tbody></table>
    <p><img src="${PNG}" width="200" alt="red"></p>
    ${Array.from({ length: 12 }, (_, i) => section(i + 1)).join("")}
  </body></html>`;

  it("renders a valid multi-page PDF with all content, links and metadata", async () => {
    loaded.length = 0;
    const r = await htmlToPdf(html, opts(), loadFont);
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPageCount()).toBe(r.pages);
    expect(r.pages).toBeGreaterThanOrEqual(3);
    expect(doc.getTitle()).toBe("Quarterly Report");

    const text = (await pdfText(r.bytes)).join("\n");
    for (const s of ["Quarterly Report", "Revenue up 12%", "İzmir", "Quoted wisdom.", "const x = 1;", "Region 39", "Section 12", "ğüşıöç", "code()", `${r.pages} / ${r.pages}`]) {
      expect(text).toContain(s);
    }
    // The 40-row table crosses a page break, and its header row repeats there.
    expect(text.match(/Region\s*Sales/g)?.length).toBe(2);

    const annots = doc.getPage(0).node.Annots();
    expect(annots?.size()).toBe(1);
    // Only the faces in use are embedded: no mono bold/italic here.
    expect(loaded).toEqual(expect.arrayContaining(["sans", "sansB", "sansI", "mono"]));
    expect(loaded).not.toContain("monoBI");
  });

  it("gets more pages with a bigger font and fewer with narrow margins", async () => {
    const base = (await htmlToPdf(html, opts(), loadFont)).pages;
    const big = (await htmlToPdf(html, opts({ fontSize: 16 }), loadFont)).pages;
    const narrow = (await htmlToPdf(html, opts({ margins: "narrow" }), loadFont)).pages;
    expect(big).toBeGreaterThan(base);
    expect(narrow).toBeLessThanOrEqual(base);
  });

  it("prints an optional title and survives empty input", async () => {
    const r = await htmlToPdf("<p></p>", opts({ title: "Başlık" }), loadFont);
    expect(r.pages).toBe(1);
    const [page] = await pdfText(r.bytes);
    expect(page).toContain("Başlık");
    expect((await PDFDocument.load(r.bytes)).getTitle()).toBe("Başlık");
  });

  it("breaks very long words instead of overflowing", async () => {
    const r = await htmlToPdf(`<p>${"x".repeat(2000)}</p>`, opts({ pageNumbers: false }), loadFont);
    const [page] = await pdfText(r.bytes);
    expect(page.replace(/\s/g, "")).toBe("x".repeat(2000));
  });
});
