import { describe, expect, it } from "vitest";
import { CATEGORIES, clean, convertUnit, formatNumber, parseNumber, plainNumber } from "./units";

const c = (v: number, cat: Parameters<typeof convertUnit>[1], from: string, to: string) => clean(convertUnit(v, cat, from, to));

describe("unit definitions", () => {
  it("has unique unit ids per category and a valid default pair", () => {
    for (const cat of CATEGORIES) {
      const ids = cat.units.map((u) => u.id);
      expect(new Set(ids).size, cat.id).toBe(ids.length);
      expect(ids).toContain(cat.pair[0]);
      expect(ids).toContain(cat.pair[1]);
    }
  });

  it("round-trips every unit through every other unit", () => {
    for (const cat of CATEGORIES)
      for (const a of cat.units)
        for (const b of cat.units) expect(c(c(42.5, cat.id, a.id, b.id), cat.id, b.id, a.id), `${cat.id} ${a.id}→${b.id}`).toBeCloseTo(42.5, 6);
  });
});

describe("reference values", () => {
  it("length", () => {
    expect(c(1, "length", "mi", "km")).toBe(1.609344);
    expect(c(1, "length", "in", "cm")).toBe(2.54);
    expect(c(1, "length", "ft", "m")).toBe(0.3048);
    expect(c(1, "length", "yd", "ft")).toBe(3);
    expect(c(1, "length", "mi", "ft")).toBe(5280);
    expect(c(1, "length", "nmi", "m")).toBe(1852);
    expect(c(1, "length", "m", "ft")).toBe(3.28083989501);
  });

  it("mass", () => {
    expect(c(1, "mass", "lb", "kg")).toBe(0.45359237);
    expect(c(1, "mass", "lb", "oz")).toBe(16);
    expect(c(1, "mass", "st", "lb")).toBe(14);
    expect(c(1, "mass", "ston", "lb")).toBe(2000);
    expect(c(1, "mass", "lton", "kg")).toBe(1016.0469088);
    expect(c(1, "mass", "ozt", "g")).toBe(31.1034768);
    expect(c(1, "mass", "ct", "mg")).toBe(200);
  });

  it("temperature", () => {
    expect(c(100, "temperature", "c", "f")).toBe(212);
    expect(c(0, "temperature", "c", "f")).toBe(32);
    expect(c(-40, "temperature", "c", "f")).toBe(-40);
    expect(c(98.6, "temperature", "f", "c")).toBe(37);
    expect(c(0, "temperature", "c", "k")).toBe(273.15);
    expect(c(0, "temperature", "k", "f")).toBe(-459.67);
    expect(c(0, "temperature", "f", "r")).toBe(459.67);
  });

  it("area", () => {
    expect(c(1, "area", "acre", "ft2")).toBe(43560);
    expect(c(1, "area", "ha", "m2")).toBe(10000);
    expect(c(1, "area", "decare", "m2")).toBe(1000);
    expect(c(1, "area", "mi2", "acre")).toBe(640);
    expect(c(1, "area", "ft2", "in2")).toBe(144);
  });

  it("volume", () => {
    expect(c(1, "volume", "usgal", "l")).toBe(3.785411784);
    expect(c(1, "volume", "ukgal", "l")).toBe(4.54609);
    expect(c(1, "volume", "usgal", "in3")).toBe(231);
    expect(c(1, "volume", "uscup", "usfloz")).toBe(8);
    expect(c(1, "volume", "ustbsp", "ustsp")).toBe(3);
    expect(c(1, "volume", "ukpt", "ukfloz")).toBe(20);
    expect(c(1, "volume", "bbl", "usgal")).toBe(42);
    expect(c(1, "volume", "m3", "l")).toBe(1000);
  });

  it("speed", () => {
    expect(c(100, "speed", "kmh", "mps")).toBe(27.7777777778);
    expect(c(60, "speed", "mph", "kmh")).toBe(96.56064);
    expect(c(1, "speed", "kn", "kmh")).toBe(1.852);
  });

  it("time", () => {
    expect(c(1, "time", "d", "s")).toBe(86400);
    expect(c(1, "time", "wk", "h")).toBe(168);
    expect(c(1, "time", "yr", "d")).toBe(365.2425);
    expect(c(1, "time", "yr", "mo")).toBe(12);
  });

  it("digital storage, SI vs IEC", () => {
    expect(c(1, "data", "kib", "b")).toBe(1024);
    expect(c(1, "data", "kb", "b")).toBe(1000);
    expect(c(1, "data", "gib", "b")).toBe(1073741824);
    expect(c(1, "data", "b", "bit")).toBe(8);
    expect(c(1, "data", "tb", "gib")).toBe(931.322574615);
  });

  it("data rate", () => {
    expect(c(100, "rate", "mbps", "mbs")).toBe(12.5);
    expect(c(1, "rate", "gbps", "mbps")).toBe(1000);
    expect(c(1, "rate", "mibs", "bps")).toBe(8388608);
  });

  it("pressure", () => {
    expect(c(1, "pressure", "atm", "pa")).toBe(101325);
    expect(c(1, "pressure", "atm", "torr")).toBe(760);
    expect(c(1, "pressure", "bar", "kpa")).toBe(100);
    expect(c(1, "pressure", "psi", "pa")).toBe(6894.75729317);
  });

  it("energy and power", () => {
    expect(c(1, "energy", "kcal", "kj")).toBe(4.184);
    expect(c(1, "energy", "kwh", "mj")).toBe(3.6);
    expect(c(1, "energy", "btu", "j")).toBe(1055.05585262);
    expect(c(1, "power", "hp", "w")).toBe(745.699871582);
    expect(c(1, "power", "ps", "w")).toBe(735.49875);
    expect(c(1, "power", "tr", "w")).toBe(3516.85284207);
  });

  it("angle and frequency", () => {
    expect(c(Math.PI, "angle", "rad", "deg")).toBe(180);
    expect(c(1, "angle", "turn", "grad")).toBe(400);
    expect(c(1, "angle", "deg", "arcsec")).toBe(3600);
    expect(c(60, "frequency", "rpm", "hz")).toBe(1);
    expect(c(1, "frequency", "ghz", "mhz")).toBe(1000);
  });

  it("fuel economy is inverse for L/100 km", () => {
    expect(c(10, "fuel", "l100", "kml")).toBe(10);
    expect(c(5, "fuel", "l100", "kml")).toBe(20);
    // Reference: L/100 km = 235.214583 / mpg (US) = 282.480936 / mpg (UK)
    expect(c(1, "fuel", "mpgus", "kml")).toBeCloseTo(0.4251437074, 9);
    expect(c(30, "fuel", "mpgus", "l100")).toBeCloseTo(235.214583 / 30, 6);
    expect(c(30, "fuel", "mpguk", "l100")).toBeCloseTo(282.480936 / 30, 6);
    expect(c(1, "fuel", "mpgus", "mpguk")).toBeCloseTo(4.54609 / 3.785411784, 10); // UK gal / US gal
    expect(convertUnit(0, "fuel", "mpgus", "l100")).toBeNaN();
  });

  it("cooking", () => {
    expect(c(1, "cooking", "uscup", "ml")).toBe(236.5882365);
    expect(c(1, "cooking", "uscup", "ustbsp")).toBe(16);
    expect(c(1, "cooking", "mtbsp", "mtsp")).toBe(3);
    expect(c(1, "cooking", "trwater", "trtea")).toBe(2);
  });
});

describe("number formatting", () => {
  it("removes float noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(plainNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(211.99999999999997)).toBe("212");
  });

  it("groups digits per locale", () => {
    expect(formatNumber(1609.344)).toBe("1,609.344");
    expect(formatNumber(1609.344, "tr")).toBe("1.609,344");
    expect(formatNumber(1609.344, "en", 10, false)).toBe("1609.344");
  });

  it("uses scientific notation for very big and very small values", () => {
    expect(formatNumber(9.4607304725808e15)).toBe("9.460730473 × 10¹⁵");
    expect(formatNumber(1.602176634e-19)).toBe("1.602176634 × 10⁻¹⁹");
    expect(plainNumber(1.602176634e-19)).toBe("1.602176634e-19");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(NaN)).toBe("—");
  });

  it("parses lenient number input", () => {
    expect(parseNumber("1,5", "tr")).toBe(1.5);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1,000")).toBe(1000);
    expect(parseNumber("1,000", "tr")).toBe(1);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber(" 1 000 ")).toBe(1000);
    expect(parseNumber("-2.5e3")).toBe(-2500);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});
