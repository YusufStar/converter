// Photo metadata (EXIF, GPS, XMP, IPTC, ICC…) read with exifr, plus the
// human-readable summary the viewer and the metadata remover show.
import { EXIF_PREFIX, concat, exifTiff, losslessFormat } from "./strip";

/** exifr output with mergeOutput off: segment name → tag → value. */
export type Groups = Record<string, Record<string, unknown>>;

export const EXIFR_OPTIONS = {
  tiff: true,
  ifd1: true,
  exif: true,
  gps: true,
  interop: true,
  xmp: true,
  icc: true,
  iptc: true,
  jfif: true,
  ihdr: true,
  makerNote: false,
  userComment: true,
  mergeOutput: false,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
};

const enc = new TextEncoder();

function app(marker: number, prefix: string, payload: Uint8Array): Uint8Array | null {
  const head = enc.encode(prefix);
  const len = 2 + head.length + payload.length;
  if (len > 0xffff) return null; // too big for one segment; skipped
  return concat([new Uint8Array([0xff, marker, len >> 8, len & 0xff]), head, payload]);
}

/**
 * exifr doesn't read WebP, so its EXIF / XMP / ICC chunks are re-wrapped as
 * the header of an (image-less) JPEG, which exifr does read.
 */
export function webpAsJpegShell(b: Uint8Array): Uint8Array | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const end = Math.min(b.length, 8 + v.getUint32(4, true));
  const segs: (Uint8Array | null)[] = [];
  for (let p = 12; p + 8 <= end; ) {
    const type = String.fromCharCode(...b.subarray(p, p + 4));
    const size = v.getUint32(p + 4, true);
    const data = b.subarray(p + 8, Math.min(end, p + 8 + size));
    if (type === "EXIF") segs.push(app(0xe1, EXIF_PREFIX, exifTiff(data)));
    if (type === "XMP ") segs.push(app(0xe1, "http://ns.adobe.com/xap/1.0/\0", data));
    if (type === "ICCP") segs.push(app(0xe2, "ICC_PROFILE\0\x01\x01", data));
    p += 8 + size + (size & 1);
  }
  const found = segs.filter((s): s is Uint8Array => s !== null);
  return found.length ? concat([new Uint8Array([0xff, 0xd8]), ...found, new Uint8Array([0xff, 0xd9])]) : null;
}

/** Segment display order. */
const GROUP_ORDER = ["ifd0", "exif", "gps", "xmp", "iptc", "icc", "ihdr", "jfif", "ifd1", "interop"];

/** Every metadata segment of the file, grouped. Empty when there is none. */
export async function readGroups(bytes: Uint8Array): Promise<Groups> {
  const input = losslessFormat(bytes) === "webp" ? webpAsJpegShell(bytes) : bytes;
  if (!input) return {};
  const { default: exifr } = await import("exifr");
  const out = ((await exifr.parse(input, EXIFR_OPTIONS)) ?? {}) as Groups;
  // Most telling segments first; empty values and empty segments dropped ("no metadata" is {}).
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return Object.fromEntries(
    Object.keys(out)
      .sort((a, b) => rank(a) - rank(b))
      .map((g) => [g, Object.fromEntries(Object.entries(out[g] ?? {}).filter(([, v]) => v != null && v !== ""))] as const)
      .filter(([, tags]) => Object.keys(tags).length),
  );
}

export function countTags(g: Groups): number {
  return Object.values(g).reduce((a, tags) => a + Object.keys(tags).length, 0);
}

// ── Summary ────────────────────────────────────────────────────────────────

export interface Gps {
  lat: number;
  lon: number;
  alt?: number;
}

export interface Summary {
  camera?: string;
  lens?: string;
  exposure?: string;
  /** Focal length (with 35 mm equivalent when known). */
  focal?: string;
  date?: string;
  software?: string;
  author?: string;
  copyright?: string;
  orientation?: string;
  colorProfile?: string;
  gps?: Gps;
}

function pick(g: Groups, ...keys: string[]): unknown {
  for (const key of keys) for (const group of GROUP_ORDER) if (g[group]?.[key] != null && g[group][key] !== "") return g[group][key];
  return undefined;
}

const str = (v: unknown) => (v == null ? undefined : (Array.isArray(v) ? v.join(", ") : String(v)).trim() || undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round = (n: number, places: number) => +n.toFixed(places);

/** 0.004 → "1/250 s", 2 → "2 s" */
export function formatExposure(t: number): string {
  if (t >= 1 || t <= 0) return `${round(t, 1)} s`;
  return `1/${Math.round(1 / t)} s`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "2024-05-01 10:00:00" (EXIF dates carry no zone; exifr revives them as local time). */
export function formatDate(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  return str(v);
}

/** 41.015 → 41° 0′ 54″ N */
export function formatDms(value: number, pos: string, neg: string): string {
  const a = Math.abs(value);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = round((a - d - m / 60) * 3600, 1);
  return `${d}° ${m}′ ${s}″ ${value < 0 ? neg : pos}`;
}

export function osmUrl({ lat, lon }: Gps): string {
  const la = round(lat, 6);
  const lo = round(lon, 6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=16/${la}/${lo}`;
}

export function summarize(g: Groups): Summary {
  const make = str(pick(g, "Make"));
  const model = str(pick(g, "Model"));
  const camera = make && model && !model.toLowerCase().startsWith(make.toLowerCase().split(" ")[0]) ? `${make} ${model}` : (model ?? make);

  const t = num(pick(g, "ExposureTime"));
  const f = num(pick(g, "FNumber"));
  const iso = pick(g, "ISO", "ISOSpeedRatings", "PhotographicSensitivity");
  const bias = num(pick(g, "ExposureBiasValue", "ExposureCompensation"));
  const exposure = [
    t !== undefined ? formatExposure(t) : null,
    f !== undefined ? `f/${round(f, 1)}` : null,
    iso != null ? `ISO ${str(iso)}` : null,
    bias ? `${bias > 0 ? "+" : ""}${round(bias, 2)} EV` : null,
  ].filter(Boolean);

  const fl = num(pick(g, "FocalLength"));
  const fl35 = num(pick(g, "FocalLengthIn35mmFormat"));
  const focal = fl !== undefined ? `${round(fl, 1)} mm${fl35 && fl35 !== Math.round(fl) ? ` (${fl35} mm eq.)` : ""}` : undefined;

  const lat = num(g.gps?.latitude);
  const lon = num(g.gps?.longitude);
  let gps: Gps | undefined;
  if (lat !== undefined && lon !== undefined && !(lat === 0 && lon === 0)) {
    const alt = num(g.gps?.GPSAltitude);
    gps = { lat, lon, alt: alt === undefined ? undefined : g.gps?.GPSAltitudeRef === 1 ? -alt : alt };
  }

  const space = str(g.icc?.ColorSpaceData);
  const colorProfile = str(g.icc?.ProfileDescription) ?? (space ? `${space} (ICC)` : str(pick(g, "ColorSpace", "ProfileName")));

  return {
    camera,
    lens: str(pick(g, "LensModel", "Lens", "LensInfo")),
    exposure: exposure.length ? exposure.join(" · ") : undefined,
    focal,
    date: formatDate(pick(g, "DateTimeOriginal", "CreateDate", "DateTimeDigitized", "DateCreated", "ModifyDate")),
    software: str(pick(g, "Software", "CreatorTool")),
    author: str(pick(g, "Artist", "Byline", "creator", "Author")),
    copyright: str(pick(g, "Copyright", "CopyrightNotice", "rights")),
    orientation: str(pick(g, "Orientation")),
    colorProfile,
    gps,
  };
}

/** Raw tag value as one line of text. */
export function formatValue(v: unknown): string {
  if (v instanceof Date) return formatDate(v) ?? "";
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `${v.byteLength} bytes`;
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (typeof v === "number") return String(round(v, 6));
  if (v && typeof v === "object") return JSON.stringify(v, (_, x) => (x instanceof Uint8Array ? `${x.length} bytes` : x));
  return String(v ?? "");
}

/** JSON export: summary + every group; binary blobs become "<n bytes>", dates local. */
export function metadataJson(name: string, g: Groups): string {
  const tags = Object.fromEntries(
    Object.entries(g).map(([group, t]) => [
      group,
      Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v instanceof Date ? formatDate(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v])),
    ]),
  );
  const summary = summarize(g);
  return JSON.stringify({ file: name, summary: { ...summary, gps: summary.gps && { ...summary.gps, map: osmUrl(summary.gps) } }, tags }, null, 2);
}

export interface RemovalReport {
  gps: boolean;
  camera: boolean;
  date: boolean;
  /** Tags present before and gone after. */
  tags: number;
}

export function removalReport(before: Groups, after: Groups): RemovalReport {
  const a = summarize(before);
  const b = summarize(after);
  return {
    gps: !!a.gps && !b.gps,
    camera: !!(a.camera || a.lens) && !(b.camera || b.lens),
    date: !!a.date && !b.date,
    tags: Math.max(0, countTags(before) - countTags(after)),
  };
}
