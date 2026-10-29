import { expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { downloadAll, downloadOne, openTool, runAndWait, sniff, trackErrors, uploadFiles, test } from "./helpers";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Page count + extracted text per page (pdfjs in Node). */
async function readPdf(bytes: Uint8Array): Promise<{ pages: number; text: string; doc: PDFDocument }> {
  expect(sniff(bytes)).toBe("pdf");
  const doc = await PDFDocument.load(bytes);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const js = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  let text = "";
  for (let i = 1; i <= js.numPages; i++) {
    const content = await (await js.getPage(i)).getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("") + "\n";
  }
  return { pages: doc.getPageCount(), text, doc };
}

async function paste(page: Page, text: string) {
  await page.getByRole("radio", { name: "Paste text" }).click();
  await page.getByTestId("paste-input").fill(text);
}

test("word → pdf keeps headings, Turkish text, lists and tables as real text", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "word-to-pdf");
  await uploadFiles(page, ["document-report.docx"]);
  await runAndWait(page);
  await expect(page.getByTestId("results")).toContainText("1 page");
  const out = await downloadOne(page);
  expect(out.name).toBe("document-report.pdf");
  const pdf = await readPdf(out.bytes);
  expect(pdf.pages).toBeGreaterThanOrEqual(1);
  for (const s of ["Quarterly Report", "ğüşıöç ĞÜŞİÖÇ", "Revenue up 12%", "İzmir", "Close the Q4 hiring plan", "Region", "Türkiye", "+21%", "1 / 1"]) {
    expect(pdf.text).toContain(s);
  }
  expect(pdf.doc.getTitle()).toBe("Quarterly Report");
  expect(errors).toEqual([]);
});

test("word → pdf honours page size and title settings", async ({ page }) => {
  await openTool(page, "word-to-pdf");
  await uploadFiles(page, ["document-report.docx"]);
  await page.getByRole("radio", { name: "Letter" }).click();
  await page.getByRole("radio", { name: "Narrow" }).click();
  await page.getByLabel("Title (optional)").fill("Board pack");
  await runAndWait(page);
  const pdf = await readPdf((await downloadOne(page)).bytes);
  expect(pdf.doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  expect(pdf.doc.getTitle()).toBe("Board pack");
  expect(pdf.text).toContain("Board pack");
});

test("word → text in bulk downloads a zip with one .txt per document", async ({ page }) => {
  await openTool(page, "word-to-text");
  await uploadFiles(page, ["document-report.docx", "doc.docx"]);
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(zip.name).toBe("word-to-text.zip");
  expect(Object.keys(zip.entries).sort()).toEqual(["doc.txt", "document-report.txt"]);
  const report = decode(zip.entries["document-report.txt"]);
  expect(report).toContain("Quarterly Report");
  expect(report).toContain("ğüşıöç");
  expect(decode(zip.entries["doc.txt"])).toContain("Quarterly Report");
  // The preview shows the first output.
  await expect(page.getByTestId("text-preview")).toHaveValue(/Quarterly Report/);
});

test("word → markdown produces headings, emphasis, lists and a pipe table", async ({ page }) => {
  await openTool(page, "word-to-markdown");
  await uploadFiles(page, ["document-report.docx"]);
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("document-report.md");
  const md = decode(out.bytes);
  expect(md).toContain("# Quarterly Report");
  expect(md).toContain("**bold**");
  expect(md).toContain("ğüşıöç");
  expect(md).toMatch(/^-\s+Revenue up 12%$/m);
  expect(md).toContain("| **Region** | **Sales** | **Growth** |");
  expect(md).toContain("| Türkiye | 95 | +21% |");
  expect(md).toContain("[Visit our site](https://example.com/)");
  expect(md).toContain("![Company logo](data:image/png;base64,");
  await expect(page.getByTestId("text-preview")).toHaveValue(/# Quarterly Report/);
});

test("word → html is a standalone page with an iframe preview", async ({ page }) => {
  await openTool(page, "word-to-html");
  await uploadFiles(page, ["document-report.docx"]);
  await runAndWait(page);
  const html = decode((await downloadOne(page)).bytes);
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain("<title>Quarterly Report</title>");
  expect(html).toContain("<h1>Quarterly Report</h1>");
  expect(html).toContain("<table>");
  expect(html).toContain('src="data:image/png;base64,');
  await expect(page.frameLocator('[data-testid="html-preview"]').getByRole("heading", { name: "Quarterly Report" })).toBeVisible();
  await page.getByRole("radio", { name: "Code" }).click();
  await expect(page.getByTestId("text-preview")).toHaveValue(/<h1>Quarterly Report<\/h1>/);
});

test("a file that isn't a real .docx fails with a clear message", async ({ page }) => {
  await openTool(page, "word-to-pdf");
  await uploadFiles(page, ["document-broken.docx"]);
  await page.getByTestId("run").click();
  await expect(page.getByTestId("queue")).toContainText("Not a valid .docx file");
});

test("markdown → pdf in bulk zips one PDF per file", async ({ page }) => {
  await openTool(page, "markdown-to-pdf");
  await uploadFiles(page, ["readme.md", "document-guide.md"]);
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(Object.keys(zip.entries).sort()).toEqual(["document-guide.pdf", "readme.pdf"]);
  const readme = await readPdf(zip.entries["readme.pdf"]);
  expect(readme.pages).toBeGreaterThanOrEqual(1);
  expect(readme.text).toContain("Release notes");
  expect(readme.text).toContain('console.log("hi")');
  const guide = await readPdf(zip.entries["document-guide.pdf"]);
  expect(guide.text).toContain("Setup guide");
  expect(guide.text).toContain("npm run build");
  expect(guide.text).toContain("ğüşıöç");
});

test("markdown → html works from pasted text", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "markdown-to-html");
  await paste(page, "# Merhaba\n\nSome **bold** ğüşıöç.\n\n- a\n- b\n");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("document.html");
  const html = decode(out.bytes);
  expect(html).toContain("<title>Merhaba</title>");
  expect(html).toContain("<strong>bold</strong>");
  await expect(page.frameLocator('[data-testid="html-preview"]').getByRole("heading", { name: "Merhaba" })).toBeVisible();
  // Playwright's tracer injects a script into every frame; the sandboxed, script-less
  // preview iframe blocks it and logs that. With tracing off the page logs nothing.
  expect(errors.filter((e) => !e.includes("about:srcdoc"))).toEqual([]);
});

test("markdown → text strips the syntax", async ({ page }) => {
  await openTool(page, "markdown-to-text");
  await uploadFiles(page, ["readme.md"]);
  await runAndWait(page);
  const text = decode((await downloadOne(page)).bytes);
  expect(text).toContain("Release notes\n\nSome bold text and a link (https://example.com).");
  expect(text).toContain("- one\n- two");
  expect(text).not.toContain("**");
});

test("html → markdown and html → text", async ({ page }) => {
  await openTool(page, "html-to-markdown");
  await uploadFiles(page, ["page.html"]);
  await runAndWait(page);
  const md = decode((await downloadOne(page)).bytes);
  expect(md).toBe("# Hello\n\nParagraph with **strong** text.\n\n1.  First\n2.  Second\n");

  await openTool(page, "html-to-text");
  await uploadFiles(page, ["page.html"]);
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("page.txt");
  expect(decode(out.bytes)).toBe("Hello\n\nParagraph with strong text.\n\n1. First\n2. Second\n");
});

test("html → pdf from pasted markup", async ({ page }) => {
  await openTool(page, "html-to-pdf");
  await paste(page, "<h1>Pasted page</h1><p>With a <a href='https://example.com'>link</a> and ğüşıöç.</p><ul><li>one</li></ul>");
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("document.pdf");
  const pdf = await readPdf(out.bytes);
  expect(pdf.text).toContain("Pasted page");
  expect(pdf.text).toContain("ğüşıöç");
  expect(pdf.doc.getPage(0).node.Annots()?.size()).toBe(1);
});

test("text → pdf with a monospace font, and text → html", async ({ page }) => {
  await openTool(page, "text-to-pdf");
  await uploadFiles(page, ["notes.txt"]);
  await page.getByRole("radio", { name: "Monospace" }).click();
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("notes.pdf");
  const pdf = await readPdf(out.bytes);
  expect(pdf.pages).toBe(1);
  expect(pdf.text).toContain("Plain text file.");
  expect(pdf.text).toContain("Second line with ğüşıöç.");

  await openTool(page, "text-to-html");
  await uploadFiles(page, ["notes.txt"]);
  await runAndWait(page);
  const html = decode((await downloadOne(page)).bytes);
  expect(html).toContain("<p>Plain text file.<br>\nSecond line with ğüşıöç.</p>");
});
