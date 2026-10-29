// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { decodeText, firstHeading, htmlToMarkdown, htmlToText, markdownToHtml, standaloneHtml, textToHtmlBody } from "./convert";

describe("htmlToText", () => {
  it("separates blocks, keeps list markers, nesting and link URLs", () => {
    const html = `<!doctype html><html><head><title>T</title><style>p{}</style></head><body>
      <h1>Quarterly   Report</h1>
      <p>Hello <b>bold</b> world,<br>second line with ğüşıöç. <a href="https://example.com/x">Site</a></p>
      <ul><li>one</li><li>two<ol start="3"><li>three</li><li><p>four</p></li></ol></li></ul>
      <script>alert(1)</script>
    </body></html>`;
    expect(htmlToText(html)).toBe(
      [
        "Quarterly Report",
        "",
        "Hello bold world,",
        "second line with ğüşıöç. Site (https://example.com/x)",
        "",
        "- one",
        "- two",
        "    3. three",
        "    4. four",
        "",
      ].join("\n"),
    );
  });

  it("writes tables as tab-separated rows and keeps preformatted text", () => {
    const html = "<table><tr><th>Region</th><th>Sales</th></tr><tr><td>EU</td><td>120</td></tr></table><pre>  a\n\n  b</pre><blockquote><p>quoted</p></blockquote>";
    expect(htmlToText(html)).toBe("Region\tSales\nEU\t120\n\n  a\n\n  b\n\n> quoted\n");
  });

  it("keeps blank lines from consecutive <br>s", () => {
    expect(htmlToText("<p>a<br><br>b</p>")).toBe("a\n\nb\n");
  });
});

describe("htmlToMarkdown", () => {
  it("produces ATX headings, emphasis, lists, fenced code and links", async () => {
    const md = await htmlToMarkdown(
      `<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em> and <del>gone</del> text with <a href="https://example.com">a link</a>.</p><ul><li>one</li><li>two</li></ul><pre><code class="language-js">console.log(1)</code></pre>`,
    );
    expect(md).toContain("# Title");
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("~~gone~~");
    expect(md).toContain("[a link](https://example.com)");
    expect(md).toMatch(/^-\s+one$/m);
    expect(md).toContain("```js\nconsole.log(1)\n```");
  });

  it("turns tables into GFM pipe tables", async () => {
    const md = await htmlToMarkdown(
      "<table><thead><tr><th><p><strong>Region</strong></p></th><th>Sales</th></tr></thead><tbody><tr><td>EU | West</td><td>120</td></tr><tr><td>TR</td></tr></tbody></table>",
    );
    expect(md.trim()).toBe(["| **Region** | Sales |", "| --- | --- |", "| EU \\| West | 120 |", "| TR |  |"].join("\n"));
  });

  it("ignores the document head", async () => {
    const md = await htmlToMarkdown("<html><head><title>Hidden</title></head><body><p>Shown</p></body></html>");
    expect(md).toBe("Shown\n");
  });
});

describe("markdownToHtml", () => {
  it("renders GFM: tables, strikethrough, task lists, fenced code", async () => {
    const html = await markdownToHtml("# Hi\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~\n\n- [x] done\n\n```js\nx()\n```\n");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>old</del>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<code class="language-js">');
  });

  it("round-trips through text", async () => {
    expect(htmlToText(await markdownToHtml("# Notes\n\nSome **bold** text.\n\n1. first\n2. second\n"))).toBe("Notes\n\nSome bold text.\n\n1. first\n2. second\n");
  });
});

describe("text helpers", () => {
  it("escapes plain text and keeps paragraphs and line breaks", () => {
    expect(textToHtmlBody("a < b\nnext\n\n\nnew & para")).toBe("<p>a &lt; b<br>\nnext</p>\n<p>new &amp; para</p>");
  });

  it("wraps fragments into a standalone, titled document", () => {
    const doc = standaloneHtml("<h1>X</h1>", 'Report "Q3" <draft>');
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain("<title>Report &quot;Q3&quot; &lt;draft&gt;</title>");
    expect(doc).toContain("<main>\n<h1>X</h1>\n</main>");
  });

  it("finds a title from <title> or the first heading", () => {
    expect(firstHeading("<title>Doc</title><h1>H</h1>")).toBe("Doc");
    expect(firstHeading("<p>x</p><h2> Sub  title </h2>")).toBe("Sub title");
  });

  it("decodes UTF-8 and UTF-16 (BOM) text", () => {
    expect(decodeText(new TextEncoder().encode("﻿ğüş"))).toBe("ğüş");
    const le = new Uint8Array([0xff, 0xfe, 0x1f, 0x01, 0x31, 0x01]);
    expect(decodeText(le)).toBe("ğı");
  });
});
