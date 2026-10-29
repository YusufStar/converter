// Page-range parsing for the PDF tools. Page numbers here are 1-based, the
// way people type them; `splitPlan` hands 0-based indices to pdf-lib.

type Bound = number | "end";

/** One comma-separated part of a range list, not yet resolved against a page count. */
export type RangeToken = { kind: "span"; from: Bound; to: Bound } | { kind: "odd" | "even" };

const END = /^(last|end|son)$/;
const ODD = /^(odd|tek)$/;
const EVEN = /^(even|çift|cift)$/;

const bound = (s: string, fallback: Bound): Bound => (s === "" ? fallback : END.test(s) ? "end" : Number(s));

/**
 * Splits "1-3, 5, 8-last" into tokens. Accepts spaces, en/em dashes, open ends
 * ("5-" = 5 to the end, "-3" = 1 to 3), "last"/"end", "odd"/"even" (and the
 * Turkish words). Throws a readable Error for anything else.
 */
export function tokenizeRanges(text: string): RangeToken[] {
  const parts = text
    .toLocaleLowerCase("tr")
    .replace(/\s*[-–—]\s*/g, "-")
    .split(/[\s,;]+/)
    .filter(Boolean);
  return parts.map((part) => {
    if (ODD.test(part)) return { kind: "odd" };
    if (EVEN.test(part)) return { kind: "even" };
    const m = /^(\d+|last|end|son)?(?:(-)(\d+|last|end|son)?)?$/.exec(part);
    if (!m || (!m[1] && !m[3] && m[2])) throw new Error(`Can't read the page range "${part}". Use numbers like 1-3, 5, 8-10`);
    const from = bound(m[1] ?? "", 1);
    const to = m[2] ? bound(m[3] ?? "", "end") : from;
    return { kind: "span", from, to };
  });
}

/**
 * Resolves a range list against a document of `total` pages. Every part
 * becomes one group of page numbers, in order: "5-3" gives [5, 4, 3].
 */
export function parseRanges(text: string, total: number): number[][] {
  return tokenizeRanges(text).map((tok) => {
    if (tok.kind !== "span") {
      const out: number[] = [];
      for (let p = tok.kind === "odd" ? 1 : 2; p <= total; p += 2) out.push(p);
      if (!out.length) throw new Error(`This PDF has no ${tok.kind} pages`);
      return out;
    }
    const from = tok.from === "end" ? total : tok.from;
    const to = tok.to === "end" ? total : tok.to;
    for (const p of [from, to]) {
      if (p < 1 || p > total) throw new Error(`Page ${p} doesn't exist — this PDF has ${total} page${total === 1 ? "" : "s"}`);
    }
    const step = from <= to ? 1 : -1;
    const out: number[] = [];
    for (let p = from; p !== to + step; p += step) out.push(p);
    return out;
  });
}

/** All pages the text names, in typed order (duplicates kept). */
export function parsePages(text: string, total: number): number[] {
  return parseRanges(text, total).flat();
}

/**
 * 0-based page indices the text selects, or null for "every page" when the
 * text is blank. Used by the tools that act on a subset (rotate, watermark…).
 */
export function pageSelection(text: string, total: number): Set<number> | null {
  if (!text.trim()) return null;
  return new Set(parsePages(text, total).map((p) => p - 1));
}

export type SplitMode = "pages" | "ranges" | "every" | "extract";

export interface SplitPart {
  /** File name suffix, e.g. "p01", "1-3", "extract". */
  suffix: string;
  /** 0-based page indices. */
  indices: number[];
}

/** "4-6" for a run of consecutive pages, "5" for one page, otherwise the keyword. */
function groupLabel(pages: number[], token: RangeToken): string {
  if (token.kind !== "span") return token.kind;
  return pages.length === 1 ? `${pages[0]}` : `${pages[0]}-${pages[pages.length - 1]}`;
}

/** Which pages go into which output file. */
export function splitPlan(total: number, mode: SplitMode, o: { ranges?: string; every?: number } = {}): SplitPart[] {
  const idx = (pages: number[]) => pages.map((p) => p - 1);
  if (mode === "pages") {
    const pad = Math.max(2, String(total).length);
    return Array.from({ length: total }, (_, i) => ({ suffix: `p${String(i + 1).padStart(pad, "0")}`, indices: [i] }));
  }
  if (mode === "every") {
    const n = Math.floor(o.every ?? 0);
    if (!(n >= 1)) throw new Error("Enter how many pages each file should have");
    const parts: SplitPart[] = [];
    for (let start = 1; start <= total; start += n) {
      const end = Math.min(total, start + n - 1);
      parts.push({ suffix: start === end ? `${start}` : `${start}-${end}`, indices: idx(parseRanges(`${start}-${end}`, total)[0]) });
    }
    return parts;
  }
  const text = o.ranges ?? "";
  if (!text.trim()) throw new Error(mode === "extract" ? "Enter the pages to extract" : "Enter at least one page range");
  if (mode === "extract") return [{ suffix: "extract", indices: idx(parsePages(text, total)) }];
  const tokens = tokenizeRanges(text);
  return parseRanges(text, total).map((pages, i) => ({ suffix: groupLabel(pages, tokens[i]), indices: idx(pages) }));
}
