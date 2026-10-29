// HTML DOM → a flat list of layout blocks (paragraph-like text, rules, images,
// tables). Pure DOM code: no fonts or PDF, so it is unit-testable with happy-dom.
import type { Piece } from "./layout";

export type RGB = [number, number, number];

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  mono: boolean;
  underline: boolean;
  strike: boolean;
  /** Inline code: drawn on a light chip. */
  code: boolean;
  size: number;
  color: RGB;
  /** Baseline shift in points (superscript > 0). */
  rise: number;
  href?: string;
}

export type Run = Piece<TextStyle>;

/** A blockquote's left bar; x is relative to the flow's left edge. */
export interface Bar {
  id: number;
  x: number;
}

interface BlockBase {
  /** Indent from the flow's left edge, in points. */
  left: number;
  /** Space above / below; adjacent margins collapse to the larger one. */
  before: number;
  after: number;
  bars: Bar[];
}

export interface TextBlock extends BlockBase {
  kind: "text";
  runs: Run[];
  size: number;
  /** Line height as a multiple of the font size. */
  lh: number;
  /** List marker drawn left of the first line. */
  marker?: Run;
  /** Keep on the same page as the next block (headings). */
  keep?: boolean;
  /** Preformatted: grey box, whitespace kept. */
  box?: boolean;
}

export interface Cell {
  blocks: Block[];
  span: number;
  head: boolean;
}

export type Block =
  | TextBlock
  | (BlockBase & { kind: "rule" })
  | (BlockBase & { kind: "image"; src: string; alt: string; width?: number; height?: number })
  | (BlockBase & { kind: "table"; rows: { cells: Cell[]; head: boolean }[] });

export interface BlockOptions {
  /** Base font size in points. */
  size: number;
  underlineLinks: boolean;
}

export const INK: RGB = [0.1, 0.11, 0.13];
export const MUTED: RGB = [0.38, 0.4, 0.44];
const LINK: RGB = [0.08, 0.36, 0.85];

const SKIP = new Set(
  "head script style template noscript title iframe object embed svg canvas video audio button select input textarea meta link map area".split(" "),
);
const BLOCK = new Set(
  "address article aside blockquote body center dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html li main menu nav ol p pre section summary table ul".split(
    " ",
  ),
);
const HEADING = [2, 1.55, 1.27, 1.1, 1, 0.9];
const BULLETS = ["•", "◦", "▪"];

interface Para {
  before: number;
  after: number;
  lh: number;
  keep?: boolean;
}

interface Ctx {
  left: number;
  bars: Bar[];
  st: TextStyle;
  para: Para;
  depth: number;
}

let barIds = 0;

/** Inline formatting from the tag and its style attribute. */
function styled(el: Element, tag: string, st: TextStyle, o: BlockOptions): TextStyle {
  let s = st;
  const set = (p: Partial<TextStyle>) => (s = { ...s, ...p });
  switch (tag) {
    case "b":
    case "strong":
    case "th":
      set({ bold: true });
      break;
    case "i":
    case "em":
    case "cite":
    case "var":
    case "dfn":
      set({ italic: true });
      break;
    case "u":
    case "ins":
      set({ underline: true });
      break;
    case "s":
    case "strike":
    case "del":
      set({ strike: true });
      break;
    case "code":
    case "kbd":
    case "samp":
    case "tt":
      set({ mono: true, code: true, size: st.size * 0.9 });
      break;
    case "small":
      set({ size: st.size * 0.85 });
      break;
    case "sup":
    case "sub":
      set({ size: st.size * 0.72, rise: st.rise + (tag === "sup" ? 0.38 : -0.18) * st.size });
      break;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) set({ href, color: LINK, underline: st.underline || o.underlineLinks });
      break;
    }
  }
  const css = el.getAttribute("style");
  if (css) {
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(css)) set({ bold: true });
    if (/font-style\s*:\s*italic/i.test(css)) set({ italic: true });
    if (/text-decoration[^;]*underline/i.test(css)) set({ underline: true });
    if (/text-decoration[^;]*line-through/i.test(css)) set({ strike: true });
  }
  return s;
}

/** Collapses HTML whitespace across runs: no leading spaces, none after a line break. */
function collapse(runs: Run[]): Run[] {
  const out: Run[] = [];
  let space = true;
  for (const r of runs) {
    let t = r.text.replace(/ *\n */g, "\n");
    if (space) t = t.replace(/^ +/, "");
    if (!t) continue;
    out.push({ text: t, st: r.st });
    space = t.endsWith(" ") || t.endsWith("\n");
  }
  return out.some((r) => /\S/.test(r.text)) ? out : [];
}

/** Expands tabs to the next multiple of 4 columns, line by line. */
export function expandTabs(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[^\t]*\t/g, (m) => m.slice(0, -1) + " ".repeat(4 - ((m.length - 1) % 4))))
    .join("\n");
}

export function baseStyle(size: number): TextStyle {
  return { bold: false, italic: false, mono: false, underline: false, strike: false, code: false, size, color: INK, rise: 0 };
}

/** Converts the children of `root` (usually document.body) into layout blocks. */
export function htmlToBlocks(root: Node, o: BlockOptions): Block[] {
  const size = o.size;
  const P: Para = { before: 0, after: size * 0.7, lh: 1.45 };
  return build(root, { left: 0, bars: [], st: baseStyle(size), para: P, depth: 0 }, o);
}

function build(root: Node, top: Ctx, o: BlockOptions): Block[] {
  const em = top.st.size;
  const P: Para = { before: 0, after: em * 0.7, lh: 1.45 };
  const LI: Para = { before: em * 0.2, after: em * 0.2, lh: 1.45 };
  const out: Block[] = [];
  let runs: Run[] = [];
  let marker: Run | undefined;
  let gap = 0;

  const push = (b: Block) => {
    b.before = Math.max(b.before, gap);
    gap = 0;
    out.push(b);
  };
  /** Margin around a container: raises the gap before its first and after its last block. */
  const open = (m: number) => (gap = Math.max(gap, m));
  const close = (m: number, from: number) => {
    const last = out[out.length - 1];
    if (out.length > from && last) last.after = Math.max(last.after, m);
  };
  const flush = (c: Ctx) => {
    const r = collapse(runs);
    runs = [];
    if (!r.length) return;
    push({ kind: "text", runs: r, size: c.st.size, lh: c.para.lh, left: c.left, bars: c.bars, before: c.para.before, after: c.para.after, keep: c.para.keep, marker });
    marker = undefined;
  };

  const walk = (node: Node, c: Ctx) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const t = (child.nodeValue ?? "").replace(/[\t\n\r\f ]+/g, " ");
        if (t) runs.push({ text: t, st: c.st });
      } else if (child.nodeType === 1) element(child as Element, c);
    }
  };

  const element = (el: Element, c: Ctx) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || el.getAttribute("hidden") !== null) return;
    if (tag === "br") {
      runs.push({ text: "\n", st: c.st });
      return;
    }
    const st = styled(el, tag, c.st, o);
    if (tag === "img") {
      flush(c);
      const src = el.getAttribute("src") ?? "";
      const num = (a: string) => {
        const v = parseFloat(el.getAttribute(a) ?? "");
        return v > 0 ? v : undefined;
      };
      push({ kind: "image", src, alt: el.getAttribute("alt") ?? "", width: num("width"), height: num("height"), left: c.left, bars: c.bars, before: em * 0.4, after: em * 0.4 });
      return;
    }
    if (!BLOCK.has(tag)) {
      walk(el, st === c.st ? c : { ...c, st });
      return;
    }

    flush(c);
    const from = out.length;
    const sub: Ctx = { ...c, st, para: P };
    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const hs = em * HEADING[Number(tag[1]) - 1];
        const hc: Ctx = { ...sub, st: { ...st, bold: true, size: hs, color: tag === "h6" ? MUTED : st.color }, para: { before: em * 0.6 + hs * 0.55, after: hs * 0.4, lh: 1.25, keep: true } };
        walk(el, hc);
        flush(hc);
        return;
      }
      case "ul":
      case "ol":
      case "menu": {
        const ordered = tag === "ol";
        const depth = c.depth + 1;
        if (depth === 1) open(em * 0.5);
        const lc: Ctx = { ...sub, left: c.left + em * 1.7, depth, para: LI };
        let n = parseInt(el.getAttribute("start") ?? "1", 10);
        if (!Number.isFinite(n)) n = 1;
        for (const li of Array.from(el.children)) {
          if (li.tagName.toLowerCase() !== "li") {
            element(li, lc);
            continue;
          }
          const box = li.querySelector(":scope > input[type=checkbox]") as HTMLInputElement | null;
          const text = box ? (box.hasAttribute("checked") ? "☑" : "☐") : ordered ? `${n++}.` : BULLETS[(depth - 1) % BULLETS.length];
          marker = { text, st: { ...lc.st, bold: false, italic: false, color: ordered ? lc.st.color : MUTED } };
          walk(li, lc);
          flush(lc);
          marker = undefined;
        }
        if (depth === 1) close(em * 0.5, from);
        return;
      }
      case "blockquote": {
        open(em * 0.6);
        const bar: Bar = { id: ++barIds, x: c.left + 1 };
        const qc: Ctx = { ...sub, left: c.left + em * 1.2, bars: [...c.bars, bar], st: { ...st, color: MUTED } };
        walk(el, qc);
        flush(qc);
        close(em * 0.6, from);
        return;
      }
      case "pre": {
        const text = expandTabs((el.textContent ?? "").replace(/\r\n?/g, "\n").replace(/^\n/, "").replace(/\n$/, ""));
        const ps = em * 0.86;
        if (text)
          push({
            kind: "text",
            box: true,
            runs: [{ text, st: { ...baseStyle(ps), mono: true } }],
            size: ps,
            lh: 1.4,
            left: c.left,
            bars: c.bars,
            before: em * 0.6,
            after: em * 0.8,
          });
        return;
      }
      case "hr":
        push({ kind: "rule", left: c.left, bars: c.bars, before: em * 0.9, after: em * 0.9 });
        return;
      case "table": {
        const rows: { cells: Cell[]; head: boolean }[] = [];
        const collect = (parent: Element, head: boolean) => {
          for (const ch of Array.from(parent.children)) {
            const t = ch.tagName.toLowerCase();
            if (t === "thead") collect(ch, true);
            else if (t === "tbody" || t === "tfoot") collect(ch, false);
            else if (t === "tr") {
              const cells = Array.from(ch.children)
                .filter((td) => /^t[dh]$/i.test(td.tagName))
                .map((td) => {
                  const th = td.tagName.toLowerCase() === "th";
                  const cs: TextStyle = { ...styled(td, th ? "th" : "td", c.st, o), color: INK };
                  const cc: Ctx = { left: 0, bars: [], st: cs, para: { ...P, after: em * 0.4, lh: 1.35 }, depth: 0 };
                  return { blocks: build(td, cc, o), span: Math.max(1, parseInt(td.getAttribute("colspan") ?? "1", 10) || 1), head: th };
                });
              if (cells.length) rows.push({ cells, head: head || cells.every((x) => x.head) });
            }
          }
        };
        collect(el, false);
        if (rows.length) push({ kind: "table", rows, left: c.left, bars: c.bars, before: em * 0.7, after: em * 0.9 });
        return;
      }
      case "dd": {
        const dc: Ctx = { ...sub, left: c.left + em * 1.7 };
        walk(el, dc);
        flush(dc);
        return;
      }
      case "dt": {
        const dc: Ctx = { ...sub, st: { ...st, bold: true }, para: { ...P, after: em * 0.2 } };
        walk(el, dc);
        flush(dc);
        return;
      }
      case "li": {
        // A stray <li> outside a list still gets a bullet.
        marker = { text: BULLETS[0], st: { ...st, color: MUTED } };
        const lc: Ctx = { ...sub, left: c.left + em * 1.7, para: LI };
        walk(el, lc);
        flush(lc);
        marker = undefined;
        return;
      }
      default:
        walk(el, sub);
        flush(sub);
    }
  };

  walk(root, top);
  flush(top);
  return out;
}
