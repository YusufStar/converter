// Text/byte encodings: Base64 (UTF-8 safe, URL-safe), data URIs, MIME sniffing,
// URL encoding, HTML entities and hex. Pure functions, no DOM.

const enc = new TextEncoder();

export class DecodeError extends Error {
  constructor(public code: "base64" | "utf8" | "uri" | "hex" | "hexOdd") {
    super(code);
  }
}

// ---------------------------------------------------------------- Base64

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  // ponytail: chunked String.fromCharCode + btoa; fine up to ~100 MB files.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Accepts standard or URL-safe alphabet, missing padding, whitespace/newlines and a data: URI prefix. */
export function base64ToBytes(input: string): Uint8Array {
  let s = input.trim();
  const uri = parseDataUri(s);
  if (uri) s = uri.data;
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.replace(/=+$/, "").length % 4 === 1) throw new DecodeError("base64");
  s = s.replace(/=+$/, "");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface Base64Options {
  urlSafe?: boolean;
  /** Break lines every 76 characters (MIME). */
  wrap?: boolean;
}

export function formatBase64(b64: string, { urlSafe = false, wrap = false }: Base64Options = {}): string {
  let s = urlSafe ? b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b64;
  if (wrap) s = s.replace(/(.{76})(?=.)/g, "$1\n");
  return s;
}

export const encodeBase64Text = (text: string, opts?: Base64Options) => formatBase64(bytesToBase64(enc.encode(text)), opts);

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DecodeError("utf8");
  }
}

export const decodeBase64Text = (b64: string) => decodeUtf8(base64ToBytes(b64));

// ---------------------------------------------------------------- data URIs + MIME

export interface DataUri {
  mime: string;
  base64: boolean;
  data: string;
}

export function parseDataUri(s: string): DataUri | null {
  const m = /^data:([^,]*?),(.*)$/s.exec(s.trim());
  if (!m) return null;
  const params = m[1].split(";").map((p) => p.trim());
  const base64 = params.at(-1)?.toLowerCase() === "base64";
  return { mime: params[0] || "text/plain", base64, data: m[2] };
}

export const toDataUri = (mime: string, b64: string) => `data:${mime || "application/octet-stream"};base64,${b64}`;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/x-7z-compressed": "7z",
  "application/vnd.rar": "rar",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/wasm": "wasm",
  "application/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
  "text/html": "html",
  "text/css": "css",
  "text/csv": "csv",
  "text/javascript": "js",
  "application/javascript": "js",
  "text/markdown": "md",
  "text/plain": "txt",
  "application/octet-stream": "bin",
};

export const extForMime = (mime: string) => EXT[mime.toLowerCase()] ?? mime.split("/")[1]?.replace(/^x-/, "").replace(/\W.*$/, "") ?? "bin";

/** Detects a file type from its first bytes; falls back to text/plain for valid UTF-8 text. */
export function sniffMime(b: Uint8Array): string {
  const str = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  const starts = (...bytes: number[]) => bytes.every((x, i) => b[i] === x);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (str(0, 4) === "GIF8") return "image/gif";
  if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP") return "image/webp";
  if (str(0, 4) === "RIFF" && str(8, 4) === "WAVE") return "audio/wav";
  if (str(4, 4) === "ftyp") {
    const brand = str(8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (/^(heic|heix|heim|heis|mif1|msf1)$/.test(brand)) return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  if (str(0, 2) === "BM" && b.length > 14) return "image/bmp";
  if (starts(0, 0, 1, 0)) return "image/x-icon";
  if (str(0, 4) === "II*\0" || str(0, 4) === "MM\0*") return "image/tiff";
  if (str(0, 5) === "%PDF-") return "application/pdf";
  if (starts(0x50, 0x4b, 3, 4) || starts(0x50, 0x4b, 5, 6)) return "application/zip";
  if (starts(0x1f, 0x8b)) return "application/gzip";
  if (starts(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return "application/x-7z-compressed";
  if (str(0, 4) === "Rar!") return "application/vnd.rar";
  if (str(0, 4) === "OggS") return "audio/ogg";
  if (str(0, 4) === "fLaC") return "audio/flac";
  if (str(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (str(0, 4) === "wOF2") return "font/woff2";
  if (str(0, 4) === "wOFF") return "font/woff";
  if (str(0, 4) === "OTTO") return "font/otf";
  if (starts(0, 1, 0, 0, 0)) return "font/ttf";
  if (starts(0, 0x61, 0x73, 0x6d)) return "application/wasm";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, 4096 * 4)).replace(/^﻿/, "");
  } catch {
    // A multi-byte character cut at the sample boundary is still text.
    if (b.length <= 4096 * 4) return "application/octet-stream";
    text = new TextDecoder().decode(b.subarray(0, 4096 * 4 - 4));
  }
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) return "application/octet-stream";
  const head = text.trimStart().slice(0, 512).toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "text/html";
  if (head.startsWith("<?xml")) return "application/xml";
  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(new TextDecoder().decode(b));
      return "application/json";
    } catch {
      // not JSON
    }
  }
  return "text/plain";
}

// ---------------------------------------------------------------- URL encoding

export type UrlMode = "component" | "uri";

export function urlEncode(text: string, mode: UrlMode = "component", plusSpaces = false): string {
  const out = mode === "component" ? encodeURIComponent(text) : encodeURI(text);
  return plusSpaces ? out.replace(/%20/g, "+") : out;
}

export function urlDecode(text: string, mode: UrlMode = "component", plusSpaces = false): string {
  const s = plusSpaces ? text.replace(/\+/g, " ") : text;
  try {
    return mode === "component" ? decodeURIComponent(s) : decodeURI(s);
  } catch {
    throw new DecodeError("uri");
  }
}

export interface UrlParts {
  protocol: string;
  host: string;
  path: string;
  params: [string, string][];
  hash: string;
}

/** Splits an absolute URL into parts with decoded query parameters; null for anything else. */
export function urlParts(s: string): UrlParts | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s/]/i.test(s.trim())) return null;
  try {
    const u = new URL(s.trim());
    return {
      protocol: u.protocol.replace(/:$/, ""),
      host: u.host,
      path: decodeURIComponentSafe(u.pathname),
      params: [...u.searchParams.entries()],
      hash: decodeURIComponentSafe(u.hash.replace(/^#/, "")),
    };
  } catch {
    return null;
  }
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------- HTML entities

// prettier-ignore
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", iexcl: "¡", cent: "¢", pound: "£", curren: "¤", yen: "¥",
  brvbar: "¦", sect: "§", uml: "¨", copy: "©", ordf: "ª", laquo: "«", not: "¬", shy: "­", reg: "®", macr: "¯", deg: "°",
  plusmn: "±", sup2: "²", sup3: "³", acute: "´", micro: "µ", para: "¶", middot: "·", cedil: "¸", sup1: "¹", ordm: "º", raquo: "»",
  frac14: "¼", frac12: "½", frac34: "¾", iquest: "¿", times: "×", divide: "÷",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç", Egrave: "È", Eacute: "É",
  Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï", ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó",
  Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø", Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", THORN: "Þ",
  szlig: "ß", agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç", egrave: "è",
  eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï", eth: "ð", ntilde: "ñ", ograve: "ò",
  oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø", ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý",
  thorn: "þ", yuml: "ÿ", Gbreve: "Ğ", gbreve: "ğ", Idot: "İ", imath: "ı", inodot: "ı", Scedil: "Ş", scedil: "ş",
  OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ", fnof: "ƒ", circ: "ˆ", tilde: "˜",
  ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍", lrm: "‎", rlm: "‏",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", dagger: "†", Dagger: "‡",
  bull: "•", hellip: "…", permil: "‰", prime: "′", Prime: "″", lsaquo: "‹", rsaquo: "›", euro: "€", trade: "™",
  larr: "←", uarr: "↑", rarr: "→", darr: "↓", harr: "↔", minus: "−", le: "≤", ge: "≥", ne: "≠", infin: "∞", asymp: "≈",
  pi: "π", mu: "μ", Omega: "Ω", alpha: "α", beta: "β", sum: "∑", radic: "√", check: "✓", hearts: "♥", star: "☆",
};

const CHAR_TO_NAME = new Map<string, string>();
for (const [name, ch] of Object.entries(NAMED_ENTITIES)) if (!CHAR_TO_NAME.has(ch) && name !== "apos") CHAR_TO_NAME.set(ch, name);

/** Escapes & < > " ' always; with `nonAscii`, every non-ASCII character too (named when one exists). */
export function htmlEncode(text: string, nonAscii = false): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "'") out += "&#39;";
    else if ("&<>\"".includes(ch)) out += `&${CHAR_TO_NAME.get(ch)};`;
    else if (nonAscii && cp > 126) out += CHAR_TO_NAME.has(ch) ? `&${CHAR_TO_NAME.get(ch)};` : `&#${cp};`;
    else out += ch;
  }
  return out;
}

/** Decodes numeric (&#231; &#xE7;) and common named entities; unknown names are left as they are. */
export function htmlDecode(text: string): string {
  return text.replace(/&(?:#(\d+);?|#x([0-9a-f]+);?|([a-z][a-z0-9]*);)/gi, (m, dec: string, hex: string, name: string) => {
    if (name) return NAMED_ENTITIES[name] ?? m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
  });
}

// ---------------------------------------------------------------- hex

export type HexSep = "space" | "none" | "0x" | "\\x";

export function bytesToHex(bytes: Uint8Array, sep: HexSep = "space", upper = false): string {
  const parts = Array.from(bytes, (x) => {
    const h = x.toString(16).padStart(2, "0");
    return upper ? h.toUpperCase() : h;
  });
  if (sep === "space") return parts.join(" ");
  if (sep === "0x") return parts.map((p) => `0x${p}`).join(" ");
  if (sep === "\\x") return parts.map((p) => `\\x${p}`).join("");
  return parts.join("");
}

export const textToHex = (text: string, sep?: HexSep, upper?: boolean) => bytesToHex(enc.encode(text), sep, upper);

/** Accepts "48 65", "4865", "0x48,0x65", "\x48\x65", "48:65". */
export function hexToBytes(input: string): Uint8Array {
  const s = input.replace(/0x|\\x/gi, "").replace(/[\s,:;-]+/g, "");
  if (!/^[0-9a-f]*$/i.test(s)) throw new DecodeError("hex");
  if (s.length % 2) throw new DecodeError("hexOdd");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const hexToText = (hex: string) => decodeUtf8(hexToBytes(hex));
