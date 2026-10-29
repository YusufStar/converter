import { describe, expect, it } from "vitest";
import { breakLines, columnWidths, measureRuns, type Piece } from "./layout";

// Fake monospace metric: every character is `size` wide.
type S = { size: number };
const A: S = { size: 1 };
const B: S = { size: 2 };
const measure = (t: string, st: S) => [...t].length * st.size;
const text = (lines: ReturnType<typeof breakLines<S>>) => lines.map((l) => l.segs.map((s) => s.text).join(""));

describe("breakLines", () => {
  it("wraps greedily at spaces and drops the space at the wrap", () => {
    const lines = breakLines([{ text: "aaa bbb ccc dd", st: A }], 7, measure);
    expect(text(lines)).toEqual(["aaa bbb", "ccc dd"]);
    expect(lines.map((l) => l.w)).toEqual([7, 6]);
  });

  it("honours hard breaks and keeps leading spaces after them", () => {
    expect(text(breakLines([{ text: "a\n  b\n\nc", st: A }], 10, measure))).toEqual(["a", "  b", "", "c"]);
  });

  it("measures each run in its own style and keeps words that span runs together", () => {
    const runs: Piece<S>[] = [
      { text: "abc ", st: A },
      { text: "cd", st: B },
      { text: "ef gh", st: A },
    ];
    // "cd" is 4 wide (size 2) + "ef" 2 → the 6-wide word "cdef" can't split, so it moves down as a whole.
    const lines = breakLines(runs, 9, measure);
    expect(text(lines)).toEqual(["abc", "cdef gh"]);
    expect(lines[1].segs.map((s) => [s.text, s.x, s.w])).toEqual([
      ["cd", 0, 4],
      ["ef gh", 4, 5],
    ]);
  });

  it("merges adjacent pieces of the same style into one segment", () => {
    const lines = breakLines([{ text: "one two three", st: A }], 100, measure);
    expect(lines).toHaveLength(1);
    expect(lines[0].segs).toHaveLength(1);
  });

  it("breaks words longer than the line between characters", () => {
    expect(text(breakLines([{ text: "x abcdefghij y", st: A }], 4, measure))).toEqual(["x", "abcd", "efgh", "ij y"]);
  });

  it("never splits a surrogate pair", () => {
    expect(text(breakLines([{ text: "😀😀😀", st: A }], 2, measure))).toEqual(["😀😀", "😀"]);
  });

  it("ignores trailing spaces", () => {
    const [line] = breakLines([{ text: "ab   ", st: A }], 10, measure);
    expect(line.w).toBe(2);
  });
});

describe("measureRuns", () => {
  it("returns the longest word and the unwrapped width", () => {
    expect(measureRuns([{ text: "a bbbb cc\ndddddd eeeeeeee", st: A }], measure)).toEqual({ min: 8, max: 15 });
  });
});

describe("columnWidths", () => {
  it("stretches content widths proportionally when they fit", () => {
    expect(columnWidths([5, 5], [10, 30], 80)).toEqual([20, 60]);
  });
  it("interpolates between min and max when only the minimum fits", () => {
    expect(columnWidths([10, 20], [20, 60], 50)).toEqual([14, 36]);
  });
  it("caps an oversized minimum at an equal share so other columns keep theirs", () => {
    // A 300-wide unbreakable word in column 3 would otherwise squeeze columns 1–2 below their words.
    expect(columnWidths([40, 30, 300], [40, 30, 600], 300)).toEqual([40, 30, 230]);
  });
  it("splits evenly when every minimum is oversized", () => {
    expect(columnWidths([30, 40], [40, 50], 20)).toEqual([10, 10]);
  });
});
