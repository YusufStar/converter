import { describe, expect, it } from "vitest";
import { addPercent, percentChange, percentOf, whatPercent } from "./percent";
import { clean } from "./units";

describe("percentages", () => {
  it("computes X% of Y", () => {
    expect(percentOf(15, 200)).toBe(30);
    expect(clean(percentOf(7.5, 80))).toBe(6);
    expect(percentOf(-10, 50)).toBe(-5);
  });

  it("computes what percent X is of Y", () => {
    expect(whatPercent(30, 200)).toBe(15);
    expect(whatPercent(1, 3)).toBeCloseTo(33.3333333, 6);
    expect(whatPercent(5, 0)).toBeNaN();
  });

  it("computes percentage change", () => {
    expect(percentChange(50, 75)).toBe(50);
    expect(percentChange(80, 60)).toBe(-25);
    expect(percentChange(-50, -25)).toBe(50);
    expect(percentChange(0, 10)).toBeNaN();
  });

  it("adds and subtracts a percentage", () => {
    expect(addPercent(200, 15)).toBe(230);
    expect(addPercent(200, -15)).toBe(170);
    expect(clean(addPercent(19.99, 20))).toBe(23.988);
  });
});
