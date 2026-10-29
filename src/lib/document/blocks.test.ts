// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { expandTabs, htmlToBlocks, type Block, type TextBlock } from "./blocks";

const blocks = (html: string) => htmlToBlocks(new DOMParser().parseFromString(html, "text/html").body, { size: 10, underlineLinks: true });
const text = (b: Block) => (b as TextBlock).runs.map((r) => r.text).join("");

describe("htmlToBlocks", () => {
  it("collapses whitespace and splits inline styles into runs", () => {
    const [p] = blocks("<p>  Hello\n   <b>bold <i>both</i></b>   <a href='https://x.test'>link</a>  </p>") as TextBlock[];
    expect(text(p)).toBe("Hello bold both link ");
    const both = p.runs.find((r) => r.text === "both")!;
    expect(both.st).toMatchObject({ bold: true, italic: true });
    const link = p.runs.find((r) => r.text === "link")!;
    expect(link.st).toMatchObject({ href: "https://x.test", underline: true });
  });

  it("sizes headings and keeps them with the next block", () => {
    const [h1, h3, p] = blocks("<h1>A</h1><h3>B</h3><p>c</p>") as TextBlock[];
    expect(h1.size).toBe(20);
    expect(h1.keep).toBe(true);
    expect(h1.runs[0].st.bold).toBe(true);
    expect(h3.size).toBeCloseTo(12.7);
    expect(p.keep).toBeUndefined();
  });

  it("indents nested lists and numbers ordered items", () => {
    const bs = blocks("<ul><li>a<ol start='4'><li>b</li><li>c</li></ol></li><li>d</li></ul>") as TextBlock[];
    expect(bs.map((b) => [text(b), b.marker?.text, b.left])).toEqual([
      ["a", "•", 17],
      ["b", "4.", 34],
      ["c", "5.", 34],
      ["d", "•", 17],
    ]);
  });

  it("marks blockquotes with a bar and preformatted text with a box", () => {
    const [q, pre] = blocks("<blockquote><p>q</p></blockquote><pre>\n  x\ty\n</pre>") as TextBlock[];
    expect(q.bars).toHaveLength(1);
    expect(q.left).toBeGreaterThan(0);
    expect(pre.box).toBe(true);
    expect(text(pre)).toBe("  x y");
    expect(pre.runs[0].st.mono).toBe(true);
  });

  it("builds tables with header rows, spans and cell content", () => {
    const [t] = blocks("<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td colspan=2><p>wide</p></td></tr></tbody></table>");
    if (t.kind !== "table") throw new Error("expected a table");
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].head).toBe(true);
    expect(t.rows[1].cells[0].span).toBe(2);
    expect(text(t.rows[0].cells[0].blocks[0])).toBe("H1");
    expect((t.rows[0].cells[0].blocks[0] as TextBlock).runs[0].st.bold).toBe(true);
  });

  it("emits images, rules and line breaks; skips scripts", () => {
    const bs = blocks("<p>a<br>b<img src='data:image/png;base64,AA' alt='pic' width='40'>c</p><hr><script>x</script>");
    expect(bs.map((b) => b.kind)).toEqual(["text", "image", "text", "rule"]);
    expect(text(bs[0])).toBe("a\nb");
    expect(bs[1]).toMatchObject({ alt: "pic", width: 40 });
  });
});

describe("expandTabs", () => {
  it("aligns to 4-column stops", () => {
    expect(expandTabs("a\tb\n\tc\nabcd\te")).toBe("a   b\n    c\nabcd    e");
  });
});
