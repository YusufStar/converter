// Document format conversions. Heavy libraries (mammoth, marked, turndown,
// pdf-lib, fonts) load on first use only.
import { htmlToPdf, textToPdf, type FontLoader, type PdfOptions } from "./html-to-pdf";

export type DocFrom = "docx" | "md" | "html" | "txt";
export type DocTo = "pdf" | "html" | "txt" | "md";

export const EXT: Record<DocTo, string> = { pdf: "pdf", html: "html", txt: "txt", md: "md" };
export const MIME: Record<DocTo, string> = {
  pdf: "application/pdf",
  html: "text/html;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** UTF-8 by default; UTF-16 files are recognised by their byte-order mark. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

// ── DOCX ──

const mammoth = async () => (await import("mammoth")).default;

function notDocx(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(/zip|central directory|corrupt/i.test(msg) ? "Not a valid .docx file (old binary .doc files aren't supported)" : msg);
}

/** DOCX → HTML fragment; images are embedded as data: URLs. */
export async function docxToHtml(data: ArrayBuffer): Promise<string> {
  try {
    return (await (await mammoth()).convertToHtml({ arrayBuffer: data })).value;
  } catch (e) {
    throw notDocx(e);
  }
}

export async function docxToText(data: ArrayBuffer): Promise<string> {
  try {
    const raw = (await (await mammoth()).extractRawText({ arrayBuffer: data })).value;
    return tidy(raw);
  } catch (e) {
    throw notDocx(e);
  }
}

// ── Markdown ──

/** GitHub-flavoured Markdown → HTML fragment. */
export async function markdownToHtml(md: string): Promise<string> {
  const { marked } = await import("marked");
  return marked.parse(md, { gfm: true, async: false });
}

/** HTML → Markdown: ATX headings, fenced code, "-" bullets, ~~strike~~ and GFM pipe tables. */
export async function htmlToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await import("turndown");
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", hr: "---" });
  td.remove(["script", "style", "noscript", "template", "iframe"]);
  td.addRule("strike", { filter: ["del", "s", "strike" as keyof HTMLElementTagNameMap], replacement: (c) => (c.trim() ? `~~${c}~~` : c) });
  td.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLTableElement).querySelectorAll("tr")).filter((tr) => tr.closest("table") === node);
      const grid = rows.map((tr) =>
        Array.from(tr.children)
          .filter((c) => /^t[dh]$/i.test(c.tagName))
          .map((c) =>
            td
              .turndown(c as HTMLElement)
              .replace(/\n+/g, " ")
              .replace(/\|/g, "\\|")
              .trim(),
          ),
      );
      const cols = Math.max(0, ...grid.map((r) => r.length));
      if (!cols) return "";
      const line = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? "").join(" | ")} |`;
      const [head, ...body] = grid;
      return `\n\n${[line(head), line(new Array(cols).fill("---")), ...body.map(line)].join("\n")}\n\n`;
    },
  });
  return `${td.turndown(parseHtml(html).body).trim()}\n`;
}

// ── HTML → text ──

const TEXT_SKIP = new Set("head script style template noscript title iframe object svg canvas button select textarea".split(" "));
const TEXT_BLOCK = new Set(
  "address article aside body center dd details dialog div dl dt fieldset figcaption figure footer form header hgroup html main nav section summary".split(" "),
);
const TEXT_PARA = new Set("p h1 h2 h3 h4 h5 h6 blockquote pre table ul ol menu hr".split(" "));

/** Collapses runs of blank lines and trims, keeping a final newline. */
function tidy(text: string): string {
  const t = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t ? `${t}\n` : "";
}

/**
 * Readable plain text: paragraphs separated by blank lines, list markers and
 * indentation kept, table cells tab-separated, link URLs in parentheses.
 */
export function htmlToText(html: string): string {
  const doc = parseHtml(html);
  let out = "";
  let owed = 0;
  let lineStart = true;
  // Right after a list marker, block breaks are ignored so "<li><p>x</p></li>" stays on the marker's line.
  let hold = false;

  const brk = (n: number) => {
    if (!hold) owed = Math.max(owed, n);
  };
  const emit = (s: string, prefix: string, raw = false) => {
    if (owed && out) {
      out += "\n".repeat(owed);
      lineStart = true;
    }
    owed = 0;
    if (lineStart) {
      if (!raw) s = s.replace(/^ +/, "");
      if (!s) return;
      out += prefix;
      lineStart = false;
    } else if (out.endsWith(" ") && s.startsWith(" ")) s = s.slice(1);
    out += s;
    if (s.trim()) hold = false;
  };

  const walk = (node: Node, prefix: string, depth: number) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        emit((child.nodeValue ?? "").replace(/\s+/g, " "), prefix);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (TEXT_SKIP.has(tag)) continue;
      switch (tag) {
        case "br":
          hold = false;
          if (lineStart && !owed && out) out += "\n";
          else owed += 1;
          continue;
        case "img": {
          const alt = el.getAttribute("alt")?.trim();
          if (alt) emit(`[${alt}]`, prefix);
          continue;
        }
        case "hr":
          brk(2);
          emit("---", prefix);
          brk(2);
          continue;
        case "pre":
          brk(2);
          (el.textContent ?? "")
            .replace(/\n$/, "")
            .split("\n")
            .forEach((line, i) => {
              if (i) brk(1);
              if (line) emit(line, prefix, true);
              else if (out) {
                out += "\n";
                lineStart = true;
              }
            });
          brk(2);
          continue;
        case "ul":
        case "ol":
        case "menu": {
          brk(depth ? 1 : 2);
          let n = parseInt(el.getAttribute("start") ?? "1", 10) || 1;
          const indent = prefix + "  ".repeat(depth);
          for (const li of Array.from(el.children)) {
            if (li.tagName.toLowerCase() !== "li") continue;
            brk(1);
            const box = li.querySelector("input[type=checkbox]");
            const marker = box ? (box.hasAttribute("checked") ? "[x] " : "[ ] ") : tag === "ol" ? `${n++}. ` : "- ";
            emit(marker, indent, true);
            hold = true;
            walk(li, indent + " ".repeat(marker.length), depth + 1);
            hold = false;
          }
          brk(depth ? 1 : 2);
          continue;
        }
        case "table":
          brk(2);
          for (const tr of Array.from(el.querySelectorAll("tr"))) {
            if (tr.closest("table") !== el) continue;
            const cells = Array.from(tr.children)
              .filter((c) => /^t[dh]$/i.test(c.tagName))
              .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
            brk(1);
            emit(cells.join("\t"), prefix, true);
          }
          brk(2);
          continue;
        case "blockquote":
          brk(2);
          walk(el, `${prefix}> `, depth);
          brk(2);
          continue;
        case "a": {
          walk(el, prefix, depth);
          const href = el.getAttribute("href") ?? "";
          const text = (el.textContent ?? "").trim();
          if (/^https?:/i.test(href) && text && text !== href && text.replace(/^https?:\/\//, "") !== href.replace(/^https?:\/\//, "")) emit(` (${href})`, prefix);
          continue;
        }
      }
      const para = TEXT_PARA.has(tag) ? 2 : TEXT_BLOCK.has(tag) || tag === "li" ? 1 : 0;
      if (para) brk(para);
      walk(el, prefix, depth);
      if (para) brk(para);
    }
  };

  walk(doc.body, "", 0);
  return tidy(out);
}

// ── standalone HTML ──

const CSS = `:root{color-scheme:light dark;--fg:#1c1d21;--muted:#5f6670;--line:#d9dce1;--soft:#f3f4f6;--link:#1558d6}
@media (prefers-color-scheme:dark){:root{--fg:#e7e9ec;--muted:#9aa1ab;--line:#3a3d44;--soft:#202227;--link:#7aa7ff}body{background:#16171a}}
*{box-sizing:border-box}
body{margin:0;color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem 4rem;overflow-wrap:break-word}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .5em}
h1{font-size:2em;margin-top:0}h2{font-size:1.5em}h3{font-size:1.25em}
p,ul,ol,dl,table,pre,blockquote,figure{margin:0 0 1em}
a{color:var(--link)}
img{max-width:100%;height:auto}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
blockquote{margin-left:0;padding:0 1em;border-left:3px solid var(--line);color:var(--muted)}
code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
:not(pre)>code{background:var(--soft);padding:.1em .35em;border-radius:4px}
pre{background:var(--soft);padding:1em;border-radius:8px;overflow-x:auto;line-height:1.45}
table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto}
th,td{border:1px solid var(--line);padding:.4em .7em;text-align:left;vertical-align:top}
th{background:var(--soft)}
td>p:last-child,th>p:last-child,li>p:last-child{margin-bottom:0}
.text p{white-space:pre-wrap}`;

/** Wraps an HTML fragment into a complete, styled document. */
export function standaloneHtml(body: string, title: string, mainClass = ""): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main${mainClass ? ` class="${mainClass}"` : ""}>
${body.trim()}
</main>
</body>
</html>
`;
}

/** Plain text → paragraphs (blank-line separated) with line breaks kept. */
export function textToHtmlBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.replace(/^\n+|\n+$/g, "")).replace(/\n/g, "<br>\n")}</p>`)
    .join("\n");
}

/** First heading text (for HTML <title> and PDF metadata). */
export function firstHeading(html: string): string {
  const doc = parseHtml(html);
  return (doc.title || doc.querySelector("h1, h2")?.textContent || "").replace(/\s+/g, " ").trim();
}

// ── dispatcher ──

export interface ConvertOptions {
  pdf: PdfOptions;
  /** Text → PDF font. */
  font: "sans" | "mono";
  /** Injected font bytes (tests); the app fetches bundled fonts. */
  loadFont?: FontLoader;
}

export interface Converted {
  blob: Blob;
  pages?: number;
}

/** Converts one document. `base` (file name without extension) is the fallback title. */
export async function convertDocument(bytes: ArrayBuffer, from: DocFrom, to: DocTo, base: string, o: ConvertOptions): Promise<Converted> {
  const text = (s: string) => ({ blob: new Blob([s], { type: MIME[to] }) });
  const pdf = async (p: Promise<{ bytes: Uint8Array; pages: number }>) => {
    const r = await p;
    return { blob: new Blob([r.bytes as BlobPart], { type: MIME.pdf }), pages: r.pages };
  };

  if (from === "docx" && to === "txt") return text(await docxToText(bytes));
  const source = from === "docx" ? "" : decodeText(new Uint8Array(bytes));

  if (from === "txt") {
    if (to === "pdf") return pdf(textToPdf(source, { ...o.pdf, font: o.font }, o.loadFont));
    if (to === "html") return text(standaloneHtml(textToHtmlBody(source), base, "text"));
    if (to === "txt") return text(source);
  }

  const html = from === "docx" ? await docxToHtml(bytes) : from === "md" ? await markdownToHtml(source) : source;
  switch (to) {
    case "pdf":
      return pdf(htmlToPdf(html, o.pdf, o.loadFont));
    case "html":
      return text(from === "html" ? html : standaloneHtml(html, firstHeading(html) || base));
    case "md":
      return text(from === "md" ? source : await htmlToMarkdown(html));
    case "txt":
      return text(htmlToText(html));
  }
}
