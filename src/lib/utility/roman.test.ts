import { describe, expect, it } from "vitest";
import { fromRoman, romanParts, toRoman } from "./roman";

describe("roman numerals", () => {
  it("converts reference values", () => {
    expect(toRoman(1)).toBe("I");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(9)).toBe("IX");
    expect(toRoman(14)).toBe("XIV");
    expect(toRoman(40)).toBe("XL");
    expect(toRoman(90)).toBe("XC");
    expect(toRoman(400)).toBe("CD");
    expect(toRoman(1994)).toBe("MCMXCIV");
    expect(toRoman(2026)).toBe("MMXXVI");
    expect(toRoman(3999)).toBe("MMMCMXCIX");
  });

  it("rejects out-of-range numbers", () => {
    expect(toRoman(0)).toBeNull();
    expect(toRoman(4000)).toBeNull();
    expect(toRoman(1.5)).toBeNull();
  });

  it("parses canonical numerals only", () => {
    expect(fromRoman("mcmxciv")).toBe(1994);
    expect(fromRoman(" MMXXVI ")).toBe(2026);
    expect(fromRoman("IIII")).toBeNull();
    expect(fromRoman("VX")).toBeNull();
    expect(fromRoman("IC")).toBeNull();
    expect(fromRoman("ABC")).toBeNull();
  });

  it("round-trips 1–3999", () => {
    for (let n = 1; n <= 3999; n++) expect(fromRoman(toRoman(n)!)).toBe(n);
  });

  it("explains the parts", () => {
    expect(romanParts(1994)).toEqual([
      [1000, "M"],
      [900, "CM"],
      [90, "XC"],
      [4, "IV"],
    ]);
  });
});
