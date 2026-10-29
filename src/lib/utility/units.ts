// Unit definitions with exact factors where a definition exists (e.g. 1 in = 0.0254 m).
// Every unit converts through its category's base unit:
//   linear:  base = value × factor
//   affine:  base = (value + offset) × factor           (temperature, base K)
//   inverse: base = factor / value                      (L/100 km, base km/L)

export interface Unit {
  id: string;
  symbol: string;
  factor: number;
  offset?: number;
  inverse?: boolean;
}

export type CategoryId =
  | "length"
  | "mass"
  | "temperature"
  | "area"
  | "volume"
  | "speed"
  | "time"
  | "data"
  | "rate"
  | "pressure"
  | "energy"
  | "power"
  | "angle"
  | "frequency"
  | "fuel"
  | "cooking";

export interface Category {
  id: CategoryId;
  units: Unit[];
  /** Default from → to pair. */
  pair: [string, string];
}

const u = (id: string, symbol: string, factor: number, extra?: Partial<Unit>): Unit => ({ id, symbol, factor, ...extra });

const IN = 0.0254;
const FT = 0.3048;
const YD = 0.9144;
const MI = 1609.344;
const LB = 0.45359237;
const US_GAL = 3.785411784; // litres (231 in³)
const UK_GAL = 4.54609; // litres
const CAL = 4.184; // thermochemical calorie, J
const BTU = 1055.05585262; // International Table BTU, J
const FT_LBF = 1.3558179483314004; // J (0.3048 m × 4.4482216152605 N)
const HP = 745.6998715822702; // mechanical horsepower, W (550 ft·lbf/s)

export const CATEGORIES: Category[] = [
  {
    id: "length",
    pair: ["m", "ft"],
    units: [
      u("nm", "nm", 1e-9),
      u("um", "µm", 1e-6),
      u("mm", "mm", 1e-3),
      u("cm", "cm", 1e-2),
      u("m", "m", 1),
      u("km", "km", 1e3),
      u("in", "in", IN),
      u("ft", "ft", FT),
      u("yd", "yd", YD),
      u("mi", "mi", MI),
      u("nmi", "nmi", 1852),
      u("au", "au", 149_597_870_700),
      u("ly", "ly", 9_460_730_472_580_800),
    ],
  },
  {
    id: "mass",
    pair: ["kg", "lb"],
    units: [
      u("ug", "µg", 1e-9),
      u("mg", "mg", 1e-6),
      u("g", "g", 1e-3),
      u("kg", "kg", 1),
      u("t", "t", 1e3),
      u("ct", "ct", 2e-4),
      u("gr", "gr", 6.479891e-5),
      u("oz", "oz", LB / 16),
      u("ozt", "oz t", 0.0311034768),
      u("lb", "lb", LB),
      u("st", "st", LB * 14),
      u("ston", "sh tn", LB * 2000),
      u("lton", "l tn", LB * 2240),
    ],
  },
  {
    id: "temperature",
    pair: ["c", "f"],
    units: [
      u("c", "°C", 1, { offset: 273.15 }),
      u("f", "°F", 5 / 9, { offset: 459.67 }),
      u("k", "K", 1),
      u("r", "°R", 5 / 9),
    ],
  },
  {
    id: "area",
    pair: ["m2", "ft2"],
    units: [
      u("mm2", "mm²", 1e-6),
      u("cm2", "cm²", 1e-4),
      u("m2", "m²", 1),
      u("decare", "daa", 1e3),
      u("ha", "ha", 1e4),
      u("km2", "km²", 1e6),
      u("in2", "in²", IN * IN),
      u("ft2", "ft²", FT * FT),
      u("yd2", "yd²", YD * YD),
      u("acre", "ac", 4046.8564224),
      u("mi2", "mi²", MI * MI),
    ],
  },
  {
    // base: litre
    id: "volume",
    pair: ["l", "usgal"],
    units: [
      u("ml", "mL", 1e-3),
      u("cl", "cL", 1e-2),
      u("l", "L", 1),
      u("m3", "m³", 1e3),
      u("cm3", "cm³", 1e-3),
      u("in3", "in³", 0.016387064),
      u("ft3", "ft³", 28.316846592),
      u("yd3", "yd³", 764.554857984),
      u("usgal", "gal (US)", US_GAL),
      u("usqt", "qt (US)", US_GAL / 4),
      u("uspt", "pt (US)", US_GAL / 8),
      u("uscup", "cup (US)", US_GAL / 16),
      u("usfloz", "fl oz (US)", US_GAL / 128),
      u("ustbsp", "tbsp (US)", US_GAL / 256),
      u("ustsp", "tsp (US)", US_GAL / 768),
      u("ukgal", "gal (UK)", UK_GAL),
      u("ukqt", "qt (UK)", UK_GAL / 4),
      u("ukpt", "pt (UK)", UK_GAL / 8),
      u("ukfloz", "fl oz (UK)", UK_GAL / 160),
      u("bbl", "bbl", US_GAL * 42),
    ],
  },
  {
    // base: m/s
    id: "speed",
    pair: ["kmh", "mph"],
    units: [
      u("mps", "m/s", 1),
      u("kmh", "km/h", 1 / 3.6),
      u("mph", "mph", MI / 3600),
      u("kn", "kn", 1852 / 3600),
      u("fts", "ft/s", FT),
      u("mach", "Ma", 340.294),
      u("light", "c", 299_792_458),
    ],
  },
  {
    // base: second
    id: "time",
    pair: ["h", "min"],
    units: [
      u("ns", "ns", 1e-9),
      u("us", "µs", 1e-6),
      u("ms", "ms", 1e-3),
      u("s", "s", 1),
      u("min", "min", 60),
      u("h", "h", 3600),
      u("d", "d", 86_400),
      u("wk", "wk", 604_800),
      u("mo", "mo", 2_629_746), // 1/12 Gregorian year
      u("yr", "yr", 31_556_952), // Gregorian year, 365.2425 d
      u("dec", "dec", 315_569_520),
      u("cen", "c.", 3_155_695_200),
    ],
  },
  {
    // base: byte
    id: "data",
    pair: ["gb", "gib"],
    units: [
      u("bit", "bit", 1 / 8),
      u("kbit", "kbit", 125),
      u("mbit", "Mbit", 125e3),
      u("gbit", "Gbit", 125e6),
      u("b", "B", 1),
      u("kb", "kB", 1e3),
      u("mb", "MB", 1e6),
      u("gb", "GB", 1e9),
      u("tb", "TB", 1e12),
      u("pb", "PB", 1e15),
      u("kib", "KiB", 2 ** 10),
      u("mib", "MiB", 2 ** 20),
      u("gib", "GiB", 2 ** 30),
      u("tib", "TiB", 2 ** 40),
      u("pib", "PiB", 2 ** 50),
    ],
  },
  {
    // base: bit/s
    id: "rate",
    pair: ["mbps", "mbs"],
    units: [
      u("bps", "bit/s", 1),
      u("kbps", "kbit/s", 1e3),
      u("mbps", "Mbit/s", 1e6),
      u("gbps", "Gbit/s", 1e9),
      u("tbps", "Tbit/s", 1e12),
      u("bs", "B/s", 8),
      u("kbs", "kB/s", 8e3),
      u("mbs", "MB/s", 8e6),
      u("gbs", "GB/s", 8e9),
      u("kibs", "KiB/s", 8 * 2 ** 10),
      u("mibs", "MiB/s", 8 * 2 ** 20),
      u("gibs", "GiB/s", 8 * 2 ** 30),
    ],
  },
  {
    // base: pascal
    id: "pressure",
    pair: ["bar", "psi"],
    units: [
      u("pa", "Pa", 1),
      u("hpa", "hPa", 100),
      u("kpa", "kPa", 1e3),
      u("mpa", "MPa", 1e6),
      u("mbar", "mbar", 100),
      u("bar", "bar", 1e5),
      u("atm", "atm", 101_325),
      u("at", "kgf/cm²", 98_066.5),
      u("psi", "psi", (LB * 9.80665) / (IN * IN)),
      u("torr", "Torr", 101_325 / 760),
      u("mmhg", "mmHg", 133.322387415),
      u("inhg", "inHg", 3386.389),
    ],
  },
  {
    // base: joule
    id: "energy",
    pair: ["kcal", "kj"],
    units: [
      u("ev", "eV", 1.602176634e-19),
      u("erg", "erg", 1e-7),
      u("j", "J", 1),
      u("kj", "kJ", 1e3),
      u("mj", "MJ", 1e6),
      u("cal", "cal", CAL),
      u("kcal", "kcal", CAL * 1e3),
      u("wh", "Wh", 3600),
      u("kwh", "kWh", 3.6e6),
      u("ftlbf", "ft·lbf", FT_LBF),
      u("btu", "BTU", BTU),
      u("therm", "thm", BTU * 1e5),
    ],
  },
  {
    // base: watt
    id: "power",
    pair: ["kw", "hp"],
    units: [
      u("milliw", "mW", 1e-3),
      u("w", "W", 1),
      u("kw", "kW", 1e3),
      u("mw", "MW", 1e6),
      u("gw", "GW", 1e9),
      u("hp", "hp", HP),
      u("ps", "PS", 735.49875),
      u("btuh", "BTU/h", BTU / 3600),
      u("kcalh", "kcal/h", (CAL * 1e3) / 3600),
      u("ftlbfs", "ft·lbf/s", FT_LBF),
      u("tr", "TR", (BTU * 12_000) / 3600),
    ],
  },
  {
    // base: degree
    id: "angle",
    pair: ["deg", "rad"],
    units: [
      u("deg", "°", 1),
      u("rad", "rad", 180 / Math.PI),
      u("mrad", "mrad", 180 / Math.PI / 1000),
      u("grad", "gon", 0.9),
      u("arcmin", "′", 1 / 60),
      u("arcsec", "″", 1 / 3600),
      u("turn", "tr", 360),
    ],
  },
  {
    // base: hertz
    id: "frequency",
    pair: ["mhz", "ghz"],
    units: [
      u("hz", "Hz", 1),
      u("khz", "kHz", 1e3),
      u("mhz", "MHz", 1e6),
      u("ghz", "GHz", 1e9),
      u("thz", "THz", 1e12),
      u("rpm", "rpm", 1 / 60),
      u("rads", "rad/s", 1 / (2 * Math.PI)),
    ],
  },
  {
    // base: km/L. L/100 km is the inverse of efficiency: base = 100 / value.
    id: "fuel",
    pair: ["l100", "mpgus"],
    units: [
      u("l100", "L/100 km", 100, { inverse: true }),
      u("kml", "km/L", 1),
      u("mpgus", "mpg (US)", MI / 1000 / US_GAL),
      u("mpguk", "mpg (UK)", MI / 1000 / UK_GAL),
    ],
  },
  {
    // base: millilitre
    id: "cooking",
    pair: ["uscup", "ml"],
    units: [
      u("ml", "mL", 1),
      u("l", "L", 1000),
      u("ustsp", "tsp (US)", (US_GAL * 1000) / 768),
      u("ustbsp", "tbsp (US)", (US_GAL * 1000) / 256),
      u("usfloz", "fl oz (US)", (US_GAL * 1000) / 128),
      u("uscup", "cup (US)", (US_GAL * 1000) / 16),
      u("uspt", "pt (US)", (US_GAL * 1000) / 8),
      u("usqt", "qt (US)", (US_GAL * 1000) / 4),
      u("mtsp", "tsp", 5),
      u("mtbsp", "tbsp", 15),
      u("mcup", "cup", 250),
      u("trtea", "çay b.", 100),
      u("trwater", "su b.", 200),
    ],
  },
];

export const categoryById = new Map(CATEGORIES.map((c) => [c.id, c]));

export function findUnit(category: CategoryId, id: string): Unit {
  const unit = categoryById.get(category)?.units.find((x) => x.id === id);
  if (!unit) throw new Error(`Unknown unit ${category}/${id}`);
  return unit;
}

function toBase(v: number, unit: Unit): number {
  if (unit.inverse) return unit.factor / v;
  return (v + (unit.offset ?? 0)) * unit.factor;
}

function fromBase(b: number, unit: Unit): number {
  if (unit.inverse) return unit.factor / b;
  return b / unit.factor - (unit.offset ?? 0);
}

/** Converts `value` between two units of a category. Non-finite results (e.g. 0 mpg → L/100 km) become NaN. */
export function convertUnit(value: number, category: CategoryId, from: string, to: string): number {
  if (from === to) return value;
  const a = findUnit(category, from);
  const b = findUnit(category, to);
  // Plain ratio first: 1 mi → km is 1609.344 / 1000 without a round trip through base rounding.
  const r = !a.offset && !b.offset && !a.inverse && !b.inverse ? (value * a.factor) / b.factor : fromBase(toBase(value, a), b);
  return Number.isFinite(r) ? r : NaN;
}

/** Rounds away float noise: 0.1 + 0.2 → 0.3, 211.99999999999997 → 212. */
export function clean(x: number, digits = 12): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(digits));
}

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/**
 * Display formatting: locale digits and grouping in the normal range, scientific
 * notation (1.5 × 10⁻⁹) for very large or very small magnitudes.
 */
export function formatNumber(x: number, locale = "en", digits = 10, grouping = true): string {
  if (Number.isNaN(x)) return "—";
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  const v = clean(x, digits);
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e15 || abs < 1e-6) {
    const [m, e] = v.toExponential(digits - 1).split("e");
    const mantissa = new Intl.NumberFormat(locale, { maximumSignificantDigits: digits }).format(Number(m));
    return `${mantissa} × 10${e.replace("+", "").replace(/./g, (c) => SUP[c] ?? c)}`;
  }
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: digits, useGrouping: grouping }).format(v);
}

/** Copy-friendly plain number: dot decimal, no grouping, e-notation when huge/tiny. */
export function plainNumber(x: number, digits = 10): string {
  if (!Number.isFinite(x)) return "";
  const v = clean(x, digits);
  const abs = Math.abs(v);
  if (v !== 0 && (abs >= 1e21 || abs < 1e-6)) return v.toExponential().replace(/\.?0+e/, "e");
  return String(v);
}

/**
 * Lenient number input: "1e3", "-2.5", "1 000", "1.234,5", "1,234.5".
 * A lone comma is a decimal comma ("1,5"), except English-style thousands groups ("1,000") when `lang` is "en".
 */
export function parseNumber(input: string, lang = "en"): number | null {
  let s = input.trim().replace(/[\s_ ]/g, "").replace(/−/g, "-");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = lang === "en" && /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
