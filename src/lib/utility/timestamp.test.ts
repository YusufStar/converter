import { describe, expect, it } from "vitest";
import { dateInZone, dayOfYear, detectUnit, formatOffset, isoInZone, isoWeek, offsetSeconds, parseTimestamp, relativeParts, relativeTime, timeZones } from "./timestamp";

describe("parseTimestamp", () => {
  it("timestamp 0 is the Unix epoch", () => {
    const p = parseTimestamp("0")!;
    expect(new Date(p.ms).toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("auto-detects seconds, milliseconds, micro- and nanoseconds", () => {
    expect(parseTimestamp("1761748200")).toEqual({ ms: 1761748200000, unit: "s" });
    expect(parseTimestamp("1761748200123")).toEqual({ ms: 1761748200123, unit: "ms" });
    expect(parseTimestamp("1761748200123456")).toEqual({ ms: 1761748200123.456, unit: "us" });
    expect(parseTimestamp("1761748200123456789")?.unit).toBe("ns");
    expect(detectUnit(-1e10)).toBe("s");
  });

  it("respects a forced unit, decimals and separators", () => {
    expect(parseTimestamp("1761748200", "ms")).toEqual({ ms: 1761748200, unit: "ms" });
    expect(parseTimestamp("1.5", "s")).toEqual({ ms: 1500, unit: "s" });
    expect(parseTimestamp("1 761 748 200")?.ms).toBe(1761748200000);
    expect(parseTimestamp("-86400")?.ms).toBe(-86400000);
  });

  it("parses date strings", () => {
    expect(parseTimestamp("2026-10-29T14:30:00Z")).toEqual({ ms: Date.UTC(2026, 9, 29, 14, 30), unit: null });
    expect(parseTimestamp("2026-10-29T17:30:00+03:00")?.ms).toBe(Date.UTC(2026, 9, 29, 14, 30));
    expect(parseTimestamp("Thu, 29 Oct 2026 14:30:00 GMT")?.ms).toBe(Date.UTC(2026, 9, 29, 14, 30));
  });

  it("rejects garbage and out-of-range values", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("yesterday-ish")).toBeNull();
    expect(parseTimestamp("9e30")).toBeNull();
    expect(parseTimestamp("99999999999999999999", "s")).toBeNull();
  });
});

describe("time zones", () => {
  const t = Date.UTC(2026, 9, 29, 14, 30); // 2026-10-29 14:30 UTC

  it("computes offsets", () => {
    expect(offsetSeconds(t, "UTC")).toBe(0);
    expect(offsetSeconds(t, "Europe/Istanbul")).toBe(3 * 3600);
    expect(offsetSeconds(t, "Asia/Kolkata")).toBe(5.5 * 3600);
    expect(offsetSeconds(t, "America/New_York")).toBe(-4 * 3600); // EDT until Nov 1
    expect(offsetSeconds(Date.UTC(2026, 11, 1), "America/New_York")).toBe(-5 * 3600);
    expect(formatOffset(-16200)).toBe("-04:30");
    expect(formatOffset(0)).toBe("+00:00");
  });

  it("formats ISO 8601 in a zone", () => {
    expect(isoInZone(t, "UTC")).toBe("2026-10-29T14:30:00.000Z");
    expect(isoInZone(t, "Europe/Istanbul")).toBe("2026-10-29T17:30:00.000+03:00");
    expect(isoInZone(t, "America/Los_Angeles")).toBe("2026-10-29T07:30:00.000-07:00");
    expect(isoInZone(0, "Europe/Istanbul")).toBe("1970-01-01T02:00:00.000+02:00");
  });

  it("finds the calendar date in a zone", () => {
    expect(dateInZone(Date.UTC(2026, 9, 29, 22), "Asia/Tokyo")).toEqual([2026, 10, 30]);
    expect(dateInZone(Date.UTC(2026, 9, 29, 2), "America/Chicago")).toEqual([2026, 10, 28]);
  });

  it("lists zones sorted by city with UTC included", () => {
    const zones = timeZones();
    expect(zones.some((z) => z.id === "UTC")).toBe(true);
    const ist = zones.find((z) => z.id === "Europe/Istanbul")!;
    expect(ist).toEqual({ id: "Europe/Istanbul", city: "Istanbul", region: "Europe" });
    expect(zones.find((z) => z.id === "America/Argentina/San_Juan")).toEqual({ id: "America/Argentina/San_Juan", city: "San Juan", region: "America/Argentina" });
    const cities = zones.map((z) => z.city);
    expect(cities).toEqual([...cities].sort((a, b) => a.localeCompare(b, "en")));
  });
});

describe("calendar helpers", () => {
  it("day of year", () => {
    expect(dayOfYear(2026, 1, 1)).toBe(1);
    expect(dayOfYear(2026, 10, 29)).toBe(302);
    expect(dayOfYear(2024, 12, 31)).toBe(366);
  });

  it("ISO week", () => {
    expect(isoWeek(2026, 10, 29)).toEqual({ week: 44, year: 2026 });
    expect(isoWeek(2021, 1, 3)).toEqual({ week: 53, year: 2020 });
    expect(isoWeek(2024, 12, 30)).toEqual({ week: 1, year: 2025 });
    expect(isoWeek(2026, 1, 1)).toEqual({ week: 1, year: 2026 });
  });
});

describe("relative time", () => {
  const now = Date.UTC(2026, 9, 29, 12);
  it("picks the largest unit", () => {
    expect(relativeParts(now - 3 * 3600e3, now)).toEqual([-3, "hour"]);
    expect(relativeParts(now + 90e3, now)).toEqual([2, "minute"]);
    expect(relativeParts(now - 35 * 86400e3, now)).toEqual([-1, "month"]);
    expect(relativeParts(now - 10 * 86400e3, now)).toEqual([-1, "week"]);
    expect(relativeParts(now - 400 * 86400e3, now)).toEqual([-1, "year"]);
    expect(relativeParts(now, now)).toEqual([0, "second"]);
  });

  it("speaks the UI language", () => {
    expect(relativeTime(now - 3 * 3600e3, now, "en")).toBe("3 hours ago");
    expect(relativeTime(now - 3 * 3600e3, now, "tr")).toBe("3 saat önce");
    expect(relativeTime(now + 86400e3, now, "en")).toBe("tomorrow");
    expect(relativeTime(now + 86400e3, now, "tr")).toBe("yarın");
  });
});
