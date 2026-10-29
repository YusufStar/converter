// Pure text-layout helpers: no DOM, no pdf-lib. Widths come from an injected
// `measure` function, so the same code runs against real font metrics in the
// browser and a fake monospace metric in unit tests.

/** A run of text in one style. "\n" is a hard line break; spaces are break opportunities. */
export interface Piece<S> {
  text: string;
  st: S;
}

/** A positioned piece of a laid-out line (x is relative to the line start). */
export interface Seg<S> extends Piece<S> {
  x: number;
  w: number;
}

export interface Line<S> {
  segs: Seg<S>[];
  w: number;
}

export type Measure<S> = (text: string, st: S) => number;

type Item<S> = { kind: "word"; parts: Piece<S>[] } | { kind: "space"; piece: Piece<S> } | { kind: "nl" };

/** Words may span several runs ("bo<b>ld</b>" is one word); spaces and "\n" separate them. */
function tokenize<S>(runs: Piece<S>[]): Item<S>[] {
  const items: Item<S>[] = [];
  let word: Piece<S>[] | null = null;
  for (const r of runs) {
    for (const tok of r.text.split(/(\n| +)/)) {
      if (!tok) continue;
      if (tok === "\n") {
        word = null;
        items.push({ kind: "nl" });
      } else if (tok[0] === " ") {
        word = null;
        items.push({ kind: "space", piece: { text: tok, st: r.st } });
      } else if (word) {
        word.push({ text: tok, st: r.st });
      } else {
        word = [{ text: tok, st: r.st }];
        items.push({ kind: "word", parts: word });
      }
    }
  }
  return items;
}

const EPS = 0.001;

/**
 * Greedy line breaking with per-run widths. Spaces are kept as typed (callers
 * collapse HTML whitespace beforehand), dropped at soft wraps and at line ends;
 * leading spaces after a hard break survive, so preformatted indentation works.
 * Words wider than the line are broken between characters.
 */
export function breakLines<S>(runs: Piece<S>[], maxW: number, measure: Measure<S>): Line<S>[] {
  const lines: Line<S>[] = [];
  let segs: Seg<S>[] = [];
  let x = 0;
  let spaces: Piece<S>[] = [];
  let soft = false;

  const add = (p: Piece<S>, w: number) => {
    const last = segs[segs.length - 1];
    // Same style object → one segment, so the PDF holds "Hello world", not per-word fragments.
    if (last && last.st === p.st) {
      last.text += p.text;
      last.w += w;
    } else segs.push({ text: p.text, st: p.st, x, w });
    x += w;
  };
  const endLine = (wrap: boolean) => {
    lines.push({ segs, w: x });
    segs = [];
    x = 0;
    spaces = [];
    soft = wrap;
  };

  for (const it of tokenize(runs)) {
    if (it.kind === "nl") {
      endLine(false);
      continue;
    }
    if (it.kind === "space") {
      if (segs.length || !soft) spaces.push(it.piece);
      continue;
    }
    const parts = it.parts.map((p) => ({ p, w: measure(p.text, p.st) }));
    const ww = parts.reduce((a, b) => a + b.w, 0);
    const sws = spaces.map((s) => measure(s.text, s.st));
    const sw = sws.reduce((a, b) => a + b, 0);
    if (segs.length && x + sw + ww > maxW + EPS) endLine(true);
    else spaces.forEach((s, i) => add(s, sws[i]));
    spaces = [];
    if (x + ww <= maxW + EPS) {
      for (const { p, w } of parts) add(p, w);
      continue;
    }
    // Longer than a whole line: break between characters (code points).
    for (const { p } of parts) {
      for (const ch of p.text) {
        const cw = measure(ch, p.st);
        if (x > 0 && x + cw > maxW + EPS) endLine(true);
        add({ text: ch, st: p.st }, cw);
      }
    }
  }
  if (segs.length) lines.push({ segs, w: x });
  return lines;
}

/** Narrowest width without breaking inside words, and the width with no wrapping at all. */
export function measureRuns<S>(runs: Piece<S>[], measure: Measure<S>): { min: number; max: number } {
  let min = 0;
  let max = 0;
  let line = 0;
  for (const it of tokenize(runs)) {
    if (it.kind === "nl") {
      line = 0;
      continue;
    }
    const w = it.kind === "space" ? measure(it.piece.text, it.piece.st) : it.parts.reduce((a, p) => a + measure(p.text, p.st), 0);
    if (it.kind === "word") min = Math.max(min, w);
    line += w;
    max = Math.max(max, line);
  }
  return { min, max };
}

/**
 * Auto table layout: columns get their content width when everything fits
 * (then stretched proportionally to fill the row), shrink towards their
 * longest-word width when it doesn't, and below that are scaled down.
 */
export function columnWidths(minimum: number[], max: number[], avail: number): number[] {
  const n = minimum.length;
  if (!n) return [];
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  // One very long unbreakable word must not starve the other columns: when the
  // minimums don't fit, none may claim more than an equal share (words break instead).
  const min = sum(minimum) > avail ? minimum.map((m) => Math.min(m, avail / n)) : minimum;
  const sMin = sum(min);
  const sMax = sum(max);
  if (sMax <= avail) return max.map((m) => m + (avail - sMax) * (sMax > 0 ? m / sMax : 1 / n));
  if (sMin >= avail) return min.map((m) => (sMin > 0 ? (m * avail) / sMin : avail / n));
  const f = (avail - sMin) / (sMax - sMin);
  return min.map((m, i) => m + (max[i] - m) * f);
}
