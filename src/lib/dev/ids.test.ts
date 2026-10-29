import { describe, expect, it } from "vitest";
import { NANOID_ALPHABETS, formatUuid, generateIds, nanoid, ulid, ulidTime, uuidv4, uuidv7, uuidv7Time } from "./ids";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UUID", () => {
  it("v4 has version 4 and the RFC variant", () => {
    const id = uuidv4();
    expect(id).toMatch(UUID);
    expect(id[14]).toBe("4");
  });

  it("v7 carries the timestamp, version 7 and the RFC variant", () => {
    const now = Date.UTC(2026, 9, 29, 12, 0, 0, 123);
    const id = uuidv7(now + 10_000);
    expect(id).toMatch(UUID);
    expect(id[14]).toBe("7");
    expect(uuidv7Time(id)).toBe(now + 10_000);
    expect(uuidv7Time(uuidv4())).toBeNull();
  });

  it("v7 sorts in creation order, even thousands within one millisecond", () => {
    const ms = Date.UTC(2030, 0, 1);
    const ids = Array.from({ length: 5000 }, () => uuidv7(ms));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    // The counter overflowed into later milliseconds instead of wrapping.
    expect(uuidv7Time(ids.at(-1)!)).toBeGreaterThan(ms);
    // A clock going backwards still yields increasing IDs.
    const later = uuidv7(ms - 5000);
    expect(later > ids.at(-1)!).toBe(true);
  });

  it("formats upper case, without hyphens and with braces", () => {
    const id = "0190b6c2-7a3e-7c4d-9f00-0123456789ab";
    expect(formatUuid(id, { upper: true })).toBe("0190B6C2-7A3E-7C4D-9F00-0123456789AB");
    expect(formatUuid(id, { hyphens: false })).toBe("0190b6c27a3e7c4d9f000123456789ab");
    expect(formatUuid(id, { braces: true, upper: true, hyphens: false })).toBe("{0190B6C27A3E7C4D9F000123456789AB}");
  });
});

describe("ULID", () => {
  it("encodes the time in the first 10 Crockford chars", () => {
    const now = 1_469_918_176_385;
    const id = ulid(now + 1_000_000_000);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulidTime(id)).toBe(now + 1_000_000_000);
    expect(ulidTime("01ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(now);
    expect(ulidTime("not-a-ulid")).toBeNull();
  });

  it("is monotonic within one millisecond", () => {
    const ms = Date.UTC(2031, 0, 1);
    const ids = Array.from({ length: 2000 }, () => ulid(ms));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every((id) => ulidTime(id) === ms)).toBe(true);
  });
});

describe("NanoID", () => {
  it("uses the requested size and alphabet", () => {
    expect(nanoid()).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(nanoid(8, NANOID_ALPHABETS.numbers)).toMatch(/^\d{8}$/);
    expect(nanoid(40, "ab")).toMatch(/^[ab]{40}$/);
    expect(() => nanoid(5, "aaa")).toThrow();
  });

  it("covers the whole alphabet without bias toward the first characters", () => {
    const counts = new Map<string, number>();
    for (const c of nanoid(36_000, NANOID_ALPHABETS.lowercase)) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(36);
    for (const n of counts.values()) expect(Math.abs(n - 1000)).toBeLessThan(200);
  });
});

describe("generateIds", () => {
  it("clamps the count to 1..1000", () => {
    expect(generateIds("v4", 0)).toHaveLength(1);
    expect(generateIds("v4", 5000)).toHaveLength(1000);
    expect(generateIds("ulid", 3)).toHaveLength(3);
    expect(generateIds("nanoid", 2, { size: 10 })[0]).toHaveLength(10);
    expect(generateIds("v7", 2, { braces: true })[0]).toMatch(/^\{.{36}\}$/);
  });
});
