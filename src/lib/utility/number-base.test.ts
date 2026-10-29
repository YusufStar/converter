import { describe, expect, it } from "vitest";
import { bitLength, groupDigits, parseInteger, toBase, twosComplement } from "./number-base";

const parse = (s: string, base: number) => {
  const r = parseInteger(s, base);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.value;
};

describe("parseInteger", () => {
  it("parses every base", () => {
    expect(parse("ff", 16)).toBe(255n);
    expect(parse("FF", 16)).toBe(255n);
    expect(parse("777", 8)).toBe(511n);
    expect(parse("1010", 2)).toBe(10n);
    expect(parse("zz", 36)).toBe(1295n);
    expect(parse("-42", 10)).toBe(-42n);
    expect(parse("1_000_000", 10)).toBe(1000000n);
    expect(parse("1111 0000", 2)).toBe(240n);
  });

  it("handles prefixes", () => {
    expect(parse("0xff", 16)).toBe(255n);
    expect(parseInteger("0xff", 10)).toEqual({ ok: true, value: 255n, base: 16 });
    expect(parseInteger("0b101", 10)).toEqual({ ok: true, value: 5n, base: 2 });
    expect(parseInteger("-0o17", 10)).toEqual({ ok: true, value: -15n, base: 8 });
    // "0b1" is a valid hex number, so the prefix is not special in base 16.
    expect(parse("0b1", 16)).toBe(0xb1n);
  });

  it("reports invalid digits and empty input", () => {
    expect(parseInteger("129", 8)).toEqual({ ok: false, error: "digit", char: "9", base: 8 });
    expect(parseInteger("102", 2)).toEqual({ ok: false, error: "digit", char: "2", base: 2 });
    expect(parseInteger("1.5", 10)).toMatchObject({ ok: false, error: "digit", char: "." });
    expect(parseInteger("  ", 10)).toEqual({ ok: false, error: "empty" });
    expect(parseInteger("-", 10)).toEqual({ ok: false, error: "empty" });
  });

  it("handles arbitrary length", () => {
    const big = "9".repeat(500);
    expect(toBase(parse(big, 10), 10)).toBe(big);
    expect(toBase(parse(toBase(parse(big, 10), 7), 7), 10)).toBe(big);
  });
});

describe("2^64 in all bases", () => {
  const n = 2n ** 64n;
  it("formats", () => {
    expect(toBase(n, 10)).toBe("18446744073709551616");
    expect(toBase(n, 2)).toBe(`1${"0".repeat(64)}`);
    expect(toBase(n, 8)).toBe("2000000000000000000000");
    expect(toBase(n, 16)).toBe("10000000000000000");
    expect(toBase(n, 3)).toBe("11112220022122120101211020120210210211221");
    expect(toBase(n, 7)).toBe("45012021522523134134602");
    expect(toBase(n, 36)).toBe("3w5e11264sgsg");
    expect(toBase(n, 36, true)).toBe("3W5E11264SGSG");
  });

  it("parses back from every base", () => {
    for (let b = 2; b <= 36; b++) expect(parse(toBase(n, b), b), `base ${b}`).toBe(n);
  });
});

describe("grouping", () => {
  it("groups from the right", () => {
    expect(groupDigits("11110000", 4)).toBe("1111 0000");
    expect(groupDigits("101", 4)).toBe("101");
    expect(groupDigits("1234567", 3, ",")).toBe("1,234,567");
    expect(groupDigits("-1234567", 3)).toBe("-1 234 567");
    expect(groupDigits("deadbeef", 4)).toBe("dead beef");
  });
});

describe("two's complement", () => {
  it("encodes negatives in 8/16/32/64 bits", () => {
    expect(twosComplement(-1n, 8)).toBe(0xffn);
    expect(twosComplement(-128n, 8)).toBe(0x80n);
    expect(twosComplement(-129n, 8)).toBeNull();
    expect(twosComplement(-1n, 16)).toBe(0xffffn);
    expect(twosComplement(-2147483648n, 32)).toBe(0x80000000n);
    expect(twosComplement(-12345n, 64)).toBe(0xffffffffffffcfc7n);
    expect(twosComplement(5n, 8)).toBe(5n);
    expect(twosComplement(128n, 8)).toBeNull();
  });

  it("measures bit length", () => {
    expect(bitLength(0n)).toBe(1);
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(-256n)).toBe(9);
    expect(bitLength(2n ** 64n)).toBe(65);
  });
});
