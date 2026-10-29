// Unix timestamp ↔ dates in UTC, local time and any IANA time zone.

export type EpochUnit = "s" | "ms" | "us" | "ns";

const PER_MS: Record<EpochUnit, number> = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 };
const MAX_MS = 8.64e15; // ECMAScript Date range

/** Guesses the unit from magnitude: up to 11 digits = seconds (until year 5138), 12–14 = ms, 15–17 = µs, more = ns. */
export function detectUnit(n: number): EpochUnit {
  const a = Math.abs(n);
  if (a < 1e11) return "s";
  if (a < 1e14) return "ms";
  if (a < 1e17) return "us";
  return "ns";
}

export type ParsedTime = { ms: number; unit: EpochUnit | null } | null;

/** Unix number (unit forced or auto-detected) or any date string Date.parse understands (ISO 8601, RFC 2822…). */
export function parseTimestamp(input: string, unit: EpochUnit | "auto" = "auto"): ParsedTime {
  const raw = input.trim();
  if (!raw) return null;
  const num = raw.replace(/[\s_,]/g, "");
  if (/^[-+]?\d+(\.\d+)?$/.test(num)) {
    const n = Number(num);
    const u = unit === "auto" ? detectUnit(n) : unit;
    const ms = n * PER_MS[u];
    return Math.abs(ms) <= MAX_MS ? { ms: Math.round(ms * 1000) / 1000, unit: u } : null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? { ms, unit: null } : null;
}

/** UTC offset of `timeZone` at instant `ms`, in seconds (e.g. Europe/Istanbul → 10800). */
export function offsetSeconds(ms: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0));
}

/** 10800 → "+03:00", -16200 → "-04:30". */
export function formatOffset(sec: number): string {
  const a = Math.abs(sec);
  const hh = String(Math.floor(a / 3600)).padStart(2, "0");
  const mm = String(Math.floor((a % 3600) / 60)).padStart(2, "0");
  return `${sec < 0 ? "-" : "+"}${hh}:${mm}`;
}

/** ISO 8601 with the zone's own offset, e.g. 2026-10-29T17:30:00.000+03:00 ("Z" for UTC). */
export function isoInZone(ms: number, timeZone: string): string {
  const off = offsetSeconds(ms, timeZone);
  const iso = new Date(ms + off * 1000).toISOString();
  return off === 0 ? iso : iso.replace("Z", formatOffset(off));
}

/** Calendar date (y, m 1–12, d) of the instant in a time zone. */
export function dateInZone(ms: number, timeZone: string): [number, number, number] {
  const d = new Date(ms + offsetSeconds(ms, timeZone) * 1000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export function dayOfYear(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

/** ISO 8601 week number and week-year (weeks start Monday; week 1 holds the first Thursday). */
export function isoWeek(y: number, m: number, d: number): { week: number; year: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday + 3); // Thursday of this week
  const year = date.getUTCFullYear();
  return { week: Math.ceil(dayOfYear(year, date.getUTCMonth() + 1, date.getUTCDate()) / 7), year };
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_556_952],
  ["month", 2_629_746],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Largest sensible unit for a difference: -10800 s → [-3, "hour"]. */
export function relativeParts(ms: number, now: number): [number, Intl.RelativeTimeFormatUnit] {
  const diff = (ms - now) / 1000;
  // Largest unit that fits; 5 weeks is past a month, so it reads "1 month".
  const [unit, sec] = UNITS.find(([, sec]) => Math.abs(diff) >= sec) ?? UNITS[UNITS.length - 1];
  return [Math.round(diff / sec), unit];
}

export function relativeTime(ms: number, now: number, lang: string): string {
  const [v, unit] = relativeParts(ms, now);
  return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(v, unit);
}

export interface ZoneOption {
  id: string;
  city: string;
  region: string;
}

/** Every IANA zone the browser knows, sorted by city so native <select> type-ahead finds "Ist…" → Istanbul. */
export function timeZones(): ZoneOption[] {
  const ids = Intl.supportedValuesOf("timeZone");
  if (!ids.includes("UTC")) ids.push("UTC");
  return ids
    .map((id) => {
      const parts = id.split("/");
      return { id, city: parts.at(-1)!.replace(/_/g, " "), region: parts.slice(0, -1).join("/").replace(/_/g, " ") };
    })
    .sort((a, b) => a.city.localeCompare(b.city, "en") || a.region.localeCompare(b.region, "en"));
}
