import { describe, expect, it } from "vitest";
import { integerWords, normalizeDecimal, numberToWords } from "./number-words";

describe("English", () => {
  it("spells integers", () => {
    expect(integerWords("0", "en")).toBe("zero");
    expect(integerWords("13", "en")).toBe("thirteen");
    expect(integerWords("21", "en")).toBe("twenty-one");
    expect(integerWords("100", "en")).toBe("one hundred");
    expect(integerWords("101", "en")).toBe("one hundred one");
    expect(integerWords("1000", "en")).toBe("one thousand");
    expect(integerWords("1234567", "en")).toBe("one million two hundred thirty-four thousand five hundred sixty-seven");
    expect(integerWords("1000000000", "en")).toBe("one billion");
    expect(integerWords("18446744073709551616", "en")).toBe(
      "eighteen quintillion four hundred forty-six quadrillion seven hundred forty-four trillion seventy-three billion seven hundred nine million five hundred fifty-one thousand six hundred sixteen",
    );
  });

  it("handles signs, decimals and money", () => {
    expect(numberToWords("-12.5", "en")).toBe("minus twelve point five");
    expect(numberToWords("3.05", "en")).toBe("three point zero five");
    expect(numberToWords("-0", "en")).toBe("zero");
    expect(numberToWords("1", "en", { currency: true })).toBe("one dollar");
    expect(numberToWords("1234.5", "en", { currency: true })).toBe("one thousand two hundred thirty-four dollars and fifty cents");
    expect(numberToWords("0.01", "en", { currency: true })).toBe("zero dollars and one cent");
    expect(numberToWords("1.999", "en", { currency: true })).toBe("two dollars");
  });
});

describe("Turkish", () => {
  it("spells integers", () => {
    expect(integerWords("0", "tr")).toBe("sıfır");
    expect(integerWords("11", "tr")).toBe("on bir");
    expect(integerWords("100", "tr")).toBe("yüz");
    expect(integerWords("101", "tr")).toBe("yüz bir");
    expect(integerWords("1000", "tr")).toBe("bin");
    expect(integerWords("1001", "tr")).toBe("bin bir");
    expect(integerWords("2026", "tr")).toBe("iki bin yirmi altı");
    expect(integerWords("101000", "tr")).toBe("yüz bir bin");
    expect(integerWords("1000000", "tr")).toBe("bir milyon");
    expect(integerWords("1001000", "tr")).toBe("bir milyon bin");
    expect(integerWords("987654321", "tr")).toBe("dokuz yüz seksen yedi milyon altı yüz elli dört bin üç yüz yirmi bir");
    expect(integerWords("2000000000", "tr")).toBe("iki milyar");
  });

  it("handles signs, decimals and money", () => {
    expect(numberToWords("-12.5", "tr")).toBe("eksi on iki virgül beş");
    expect(numberToWords("3.05", "tr")).toBe("üç virgül sıfır beş");
    expect(numberToWords("12.25", "tr")).toBe("on iki virgül yirmi beş");
    expect(numberToWords("1250.5", "tr", { currency: true })).toBe("bin iki yüz elli Türk lirası elli kuruş");
    expect(numberToWords("100", "tr", { currency: true })).toBe("yüz Türk lirası");
  });
});

describe("normalizeDecimal", () => {
  it("reads both notations", () => {
    expect(normalizeDecimal("1,234.56", "en")).toBe("1234.56");
    expect(normalizeDecimal("1.234,56", "tr")).toBe("1234.56");
    expect(normalizeDecimal("1.234,56", "en")).toBe("1234.56");
    expect(normalizeDecimal("12,5", "tr")).toBe("12.5");
    expect(normalizeDecimal("12,5", "en")).toBe("12.5");
    expect(normalizeDecimal("1,000", "en")).toBe("1000");
    expect(normalizeDecimal("1,000", "tr")).toBe("1.000");
    expect(normalizeDecimal("1.000", "tr")).toBe("1000");
    expect(normalizeDecimal("1 000 000", "tr")).toBe("1000000");
    expect(normalizeDecimal("-0,5", "tr")).toBe("-0.5");
    expect(normalizeDecimal(".5", "en")).toBe("0.5");
  });

  it("rejects non-numbers", () => {
    expect(normalizeDecimal("abc", "en")).toBeNull();
    expect(normalizeDecimal("1.2.3,4,5", "en")).toBeNull();
    expect(normalizeDecimal("", "en")).toBeNull();
    expect(normalizeDecimal(",", "en")).toBeNull();
  });
});
