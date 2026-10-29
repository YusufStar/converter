import { describe, expect, it } from "vitest";
import { pageSelection, parsePages, parseRanges, splitPlan, tokenizeRanges } from "./ranges";

describe("parseRanges", () => {
  it("reads single pages and spans", () => {
    expect(parseRanges("1-3, 5, 8-10", 10)).toEqual([[1, 2, 3], [5], [8, 9, 10]]);
  });

  it("tolerates spaces, dashes and separators", () => {
    expect(parseRanges(" 1 - 3 ;5   7–8 ", 10)).toEqual([[1, 2, 3], [5], [7, 8]]);
    expect(parseRanges("2—4", 5)).toEqual([[2, 3, 4]]);
    expect(parseRanges("1,,2,", 2)).toEqual([[1], [2]]);
  });

  it("keeps reversed spans in reverse order", () => {
    expect(parseRanges("5-3", 6)).toEqual([[5, 4, 3]]);
    expect(parseRanges("last-1", 3)).toEqual([[3, 2, 1]]);
  });

  it("understands last / end / son and open ends", () => {
    expect(parseRanges("last", 7)).toEqual([[7]]);
    expect(parseRanges("5-end", 7)).toEqual([[5, 6, 7]]);
    expect(parseRanges("6-SON", 7)).toEqual([[6, 7]]);
    expect(parseRanges("5-", 7)).toEqual([[5, 6, 7]]);
    expect(parseRanges("-3", 7)).toEqual([[1, 2, 3]]);
  });

  it("supports odd and even pages", () => {
    expect(parseRanges("odd", 5)).toEqual([[1, 3, 5]]);
    expect(parseRanges("even", 5)).toEqual([[2, 4]]);
    expect(parseRanges("tek, çift", 4)).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(() => parseRanges("even", 1)).toThrow("no even pages");
  });

  it("rejects pages outside the document", () => {
    expect(() => parseRanges("1-12", 10)).toThrow("Page 12 doesn't exist — this PDF has 10 pages");
    expect(() => parseRanges("0", 3)).toThrow("Page 0 doesn't exist");
    expect(() => parseRanges("2", 1)).toThrow("this PDF has 1 page");
  });

  it("rejects junk with a readable message", () => {
    for (const bad of ["abc", "1-2-3", "-", "1.5", "3x"]) expect(() => tokenizeRanges(bad)).toThrow(/Can't read the page range/);
  });

  it("returns nothing for blank input", () => {
    expect(parseRanges("  ", 3)).toEqual([]);
  });
});

describe("parsePages / pageSelection", () => {
  it("flattens in typed order and keeps duplicates", () => {
    expect(parsePages("3, 1-2, 1", 3)).toEqual([3, 1, 2, 1]);
  });

  it("selection is 0-based and null when blank", () => {
    expect(pageSelection("", 4)).toBeNull();
    expect([...pageSelection("2-3, 3", 4)!]).toEqual([1, 2]);
  });
});

describe("splitPlan", () => {
  it("every page → one part per page with padded suffixes", () => {
    const plan = splitPlan(3, "pages");
    expect(plan.map((p) => p.suffix)).toEqual(["p01", "p02", "p03"]);
    expect(plan.map((p) => p.indices)).toEqual([[0], [1], [2]]);
    expect(splitPlan(120, "pages")[0].suffix).toBe("p001");
  });

  it("custom ranges → one part per range", () => {
    const plan = splitPlan(10, "ranges", { ranges: "1-3, 5, 8-last, odd" });
    expect(plan.map((p) => p.suffix)).toEqual(["1-3", "5", "8-10", "odd"]);
    expect(plan[0].indices).toEqual([0, 1, 2]);
    expect(plan[3].indices).toEqual([0, 2, 4, 6, 8]);
  });

  it("every N pages → chunks with a short last one", () => {
    const plan = splitPlan(7, "every", { every: 3 });
    expect(plan.map((p) => p.suffix)).toEqual(["1-3", "4-6", "7"]);
    expect(plan[2].indices).toEqual([6]);
    expect(() => splitPlan(7, "every", { every: 0 })).toThrow();
  });

  it("extract → a single part in typed order", () => {
    expect(splitPlan(9, "extract", { ranges: "9, 1-2" })).toEqual([{ suffix: "extract", indices: [8, 0, 1] }]);
    expect(() => splitPlan(9, "extract", { ranges: " " })).toThrow("Enter the pages to extract");
  });
});
