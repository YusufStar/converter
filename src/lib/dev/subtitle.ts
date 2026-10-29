// Subtitle parsing/writing: SRT, WebVTT, ASS/SSA (read), SBV and MicroDVD SUB, plus time
// shift, frame-rate retiming and legacy encoding detection (Turkish Windows-1254 vs 1252).
// Cue text keeps only <i>, <b> and <u>; every other style is dropped.

export type SubFormat = "srt" | "vtt" | "ass" | "ssa" | "sbv" | "sub";
export type OutFormat = "srt" | "vtt" | "sbv" | "sub";
export type TextEncodingId = "utf-8" | "utf-16le" | "utf-16be" | "windows-1254" | "windows-1252";

export interface Cue {
  /** Milliseconds. */
  start: number;
  end: number;
  text: string;
}

export class SubtitleError extends Error {
  constructor(public code: "format" | "image" | "empty") {
    super(code === "format" ? "Unrecognised subtitle format" : code === "image" ? "Image-based (VobSub) subtitles can't be converted to text" : "No subtitles found");
  }
}

// ---------------------------------------------------------------- time

/** "01:02:03,456", "1:02:03.45", "02:03.4" → ms (fraction is a decimal: .45 = 450 ms). */
export function parseTime(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  const [, h = "0", min, sec, frac = "0"] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + Number(frac.padEnd(3, "0"));
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatTime(ms: number, sep: "," | ".", hourDigits = 2): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor(t / 60_000) % 60;
  const s = Math.floor(t / 1000) % 60;
  return `${pad(h, hourDigits)}:${pad(m)}:${pad(s)}${sep}${pad(t % 1000, 3)}`;
}

// ---------------------------------------------------------------- markup

const KEEP = /<\/?([ibu])>/gi;

/** Drops unmatched / duplicate <i><b><u> tags and closes whatever is still open. */
export function balanceTags(text: string): string {
  const open: string[] = [];
  const out = text.replace(/<(\/?)([ibu])>/g, (_, close: string, tag: string) => {
    if (close) {
      if (!open.includes(tag)) return "";
      open.splice(open.lastIndexOf(tag), 1);
      return `</${tag}>`;
    }
    if (open.includes(tag)) return "";
    open.push(tag);
    return `<${tag}>`;
  });
  return out + open.reverse().map((t) => `</${t}>`).join("");
}

/** Keeps <i>/<b>/<u> (lower-cased), strips other tags and ASS-style {\an8} overrides. */
function cleanMarkup(text: string): string {
  return balanceTags(
    text
      .replace(/\{\\[^}]*\}/g, "")
      .replace(/<[^>]*>/g, (tag) => (/^<\/?[ibu]>$/i.test(tag) ? tag.toLowerCase() : "")),
  );
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", lrm: "\u200e", rlm: "\u200f" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

const stripTags = (s: string) => s.replace(KEEP, "");

/** Text lines without blank ones (a blank line would end the cue in SRT/VTT/SBV). */
const tidy = (lines: string[]) =>
  lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

const normalize = (text: string) => text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

// ---------------------------------------------------------------- readers

const ARROW = /^\s*(\S+)\s*-->\s*(\S+)/;

export function parseSrt(text: string): Cue[] {
  const cues: (Cue & { lines: string[] })[] = [];
  for (const line of normalize(text).split("\n")) {
    const m = ARROW.exec(line);
    const start = m && parseTime(m[1]);
    const end = m && parseTime(m[2]);
    if (start !== null && end !== null && m) {
      const prev = cues.at(-1);
      // The cue number belongs to this cue, not to the previous text.
      if (prev && /^\s*\d+\s*$/.test(prev.lines.at(-1) ?? "")) prev.lines.pop();
      cues.push({ start, end, text: "", lines: [] });
    } else cues.at(-1)?.lines.push(line);
  }
  return cues.map(({ start, end, lines }) => ({ start, end, text: cleanMarkup(tidy(lines)) }));
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of normalize(text).replace(/^[ \t]+$/gm, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (/^NOTE(\s|$)/.test(lines[0])) continue;
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const m = ARROW.exec(lines[i]);
    const start = m && parseTime(m[1]);
    const end = m && parseTime(m[2]);
    if (start === null || end === null) continue;
    cues.push({ start, end, text: decodeEntities(cleanMarkup(tidy(lines.slice(i + 1)))) });
  }
  return cues;
}

const ASS_DEFAULT = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];

/** ASS override blocks: {\i1}…{\i0} become <i>…</i>; positions, colours, karaoke etc. go. */
function assText(s: string): string | null {
  if (/\{[^}]*\\p[1-9]/.test(s)) return null; // vector drawing, not text
  const text = s
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .replace(/\{([^}]*)\}/g, (_, tags: string) =>
      [...tags.matchAll(/\\([ibu])([01])(?!\d)/g)].map(([, tag, on]) => (on === "1" ? `<${tag}>` : `</${tag}>`)).join(""),
    );
  return balanceTags(tidy(text.split("\n")));
}

export function parseAss(text: string): Cue[] {
  let fields = ASS_DEFAULT;
  let section = "";
  const cues: Cue[] = [];
  for (const line of normalize(text).split("\n")) {
    const head = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (head) {
      section = head[1].toLowerCase();
      continue;
    }
    if (section !== "events") continue;
    const m = /^\s*(Format|Dialogue)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    if (m[1].toLowerCase() === "format") {
      fields = m[2].split(",").map((f) => f.trim().toLowerCase());
      continue;
    }
    const values = m[2].split(",");
    const textAt = fields.indexOf("text");
    const get = (name: string) => values[fields.indexOf(name)] ?? "";
    const start = parseTime(get("start"));
    const end = parseTime(get("end"));
    const body = assText(values.slice(textAt < 0 ? fields.length - 1 : textAt).join(","));
    if (start !== null && end !== null && body) cues.push({ start, end, text: body });
  }
  // Events are not required to be in time order.
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSbv(text: string): Cue[] {
  const cues: (Cue & { lines: string[] })[] = [];
  for (const line of normalize(text).split("\n")) {
    const m = /^\s*([\d:.]+)\s*,\s*([\d:.]+)\s*$/.exec(line);
    const start = m && parseTime(m[1]);
    const end = m && parseTime(m[2]);
    if (start !== null && end !== null && m) cues.push({ start, end, text: "", lines: [] });
    else cues.at(-1)?.lines.push(line);
  }
  // SubViewer (.sub) uses the same timing lines with [br] as the line break.
  return cues.map(({ start, end, lines }) => ({ start, end, text: cleanMarkup(tidy(lines.join("\n").replace(/\[br\]/gi, "\n").split("\n"))) }));
}

/** MicroDVD: {startFrame}{endFrame}line|line. A first {1}{1}23.976 line declares the frame rate. */
export function parseSub(text: string, fps = 23.976): { cues: Cue[]; fps: number } {
  const cues: Cue[] = [];
  let rate = fps;
  normalize(text)
    .split("\n")
    .forEach((line, i) => {
      const m = /^\s*\{(\d+)\}\{(\d*)\}(.*)$/.exec(line);
      if (!m) return;
      const declared = Number(m[3].trim());
      if (i === 0 && Number(m[1]) <= 1 && /^\d+(\.\d+)?$/.test(m[3].trim()) && declared > 0 && declared < 200) {
        rate = declared;
        return;
      }
      const start = (Number(m[1]) / rate) * 1000;
      const end = m[2] ? (Number(m[2]) / rate) * 1000 : start + 2000;
      const italic = /\{y:[^}]*i/i.test(m[3]);
      let body = tidy(m[3].replace(/\{[^}]*\}/g, "").split("|"));
      if (italic && body) body = `<i>${body}</i>`;
      if (body) cues.push({ start: Math.round(start), end: Math.round(end), text: body });
    });
  return { cues, fps: rate };
}

/** Sniffs the format from the content, falling back to the file extension. */
export function detectFormat(text: string, ext = ""): SubFormat {
  const t = normalize(text).trimStart();
  if (/^WEBVTT/.test(t)) return "vtt";
  if (/^\[Script Info\]/im.test(t) || /^\[Events\]/im.test(t)) return /^\[V4 Styles\]/im.test(t) ? "ssa" : "ass";
  if (/^\{\d+\}\{\d*\}/m.test(t)) return "sub";
  if (/^\s*\d+:\d{1,2}:\d{1,2}\.\d{1,3},\d+:\d{1,2}:\d{1,2}\.\d{1,3}\s*$/m.test(t)) return "sbv";
  if (/-->/.test(t)) return ext === "vtt" ? "vtt" : "srt";
  if (["srt", "vtt", "ass", "ssa", "sbv", "sub"].includes(ext)) throw new SubtitleError("empty");
  throw new SubtitleError("format");
}

export function parseSubtitles(text: string, format: SubFormat, fps?: number): Cue[] {
  switch (format) {
    case "vtt":
      return parseVtt(text);
    case "ass":
    case "ssa":
      return parseAss(text);
    case "sbv":
      return parseSbv(text);
    case "sub":
      return parseSub(text, fps).cues;
    default:
      return parseSrt(text);
  }
}

// ---------------------------------------------------------------- writers

/** VTT text: & and < that aren't one of our tags are escaped. */
const vttEscape = (s: string) =>
  s
    .split(/(<\/?[ibu]>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("");

export function writeSubtitles(cues: Cue[], format: OutFormat, fps = 23.976): string {
  const list = cues.filter((c) => c.text.trim());
  switch (format) {
    case "vtt":
      return `WEBVTT\n\n${list.map((c) => `${formatTime(c.start, ".")} --> ${formatTime(c.end, ".")}\n${vttEscape(c.text).replace(/-->/g, "--&gt;")}\n`).join("\n")}`;
    case "sbv":
      return list.map((c) => `${formatTime(c.start, ".", 1)},${formatTime(c.end, ".", 1)}\n${stripTags(c.text)}\n`).join("\n");
    case "sub": {
      const frame = (ms: number) => Math.round((ms * fps) / 1000);
      return list.map((c) => `{${frame(c.start)}}{${frame(c.end)}}${stripTags(c.text).replace(/\n/g, "|")}\n`).join("");
    }
    default:
      return list.map((c, i) => `${i + 1}\n${formatTime(c.start, ",")} --> ${formatTime(c.end, ",")}\n${c.text}\n`).join("\n");
  }
}

export interface Retime {
  /** Added to every time after the frame-rate change (may be negative). */
  shiftMs?: number;
  /** Frame rate the subtitles were timed for → frame rate of the target video. */
  fromFps?: number | null;
  toFps?: number | null;
}

/** Applies FPS conversion then shift; cues pushed entirely before 0 are dropped. */
export function retimeCues(cues: Cue[], { shiftMs = 0, fromFps, toFps }: Retime): Cue[] {
  const k = fromFps && toFps ? fromFps / toFps : 1;
  return cues
    .map((c) => ({ ...c, start: Math.round(c.start * k + shiftMs), end: Math.round(Math.max(c.end, c.start) * k + shiftMs) }))
    .filter((c) => c.end > 0)
    .map((c) => ({ ...c, start: Math.max(0, c.start) }));
}

// ---------------------------------------------------------------- encoding

/** Bytes that are Turkish letters in Windows-1254 (Ğ İ Ş ğ ı ş) but rare Icelandic ones in 1252. */
const TURKISH = new Set([0xd0, 0xdd, 0xde, 0xf0, 0xfd, 0xfe]);

export function detectEncoding(bytes: Uint8Array): TextEncodingId {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // UTF-16 without a BOM: ASCII text leaves every other byte zero.
  const head = bytes.subarray(0, 4000);
  let even = 0;
  let odd = 0;
  head.forEach((b, i) => b === 0 && (i % 2 ? odd++ : even++));
  if (odd > head.length / 4) return "utf-16le";
  if (even > head.length / 4) return "utf-16be";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    // Not UTF-8: a legacy single-byte code page.
  }
  for (const b of bytes) if (TURKISH.has(b)) return "windows-1254";
  return "windows-1252";
}

export function decodeText(bytes: Uint8Array, encoding: TextEncodingId | "auto" = "auto"): { text: string; encoding: TextEncodingId } {
  const enc = encoding === "auto" ? detectEncoding(bytes) : encoding;
  return { text: new TextDecoder(enc).decode(bytes), encoding: enc };
}

// ---------------------------------------------------------------- one file

export interface ConvertOptions extends Retime {
  to: OutFormat;
  encoding?: TextEncodingId | "auto";
  /** MicroDVD frame rate (input without a declared rate, and output). */
  subFps?: number;
}

export interface Converted {
  text: string;
  from: SubFormat;
  encoding: TextEncodingId;
  cues: number;
}

export function convertSubtitle(bytes: Uint8Array, ext: string, opts: ConvertOptions): Converted {
  // VobSub .sub files are MPEG program streams (pictures, not text).
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0xba) throw new SubtitleError("image");
  const { text, encoding } = decodeText(bytes, opts.encoding);
  const from = detectFormat(text, ext.toLowerCase());
  const cues = retimeCues(parseSubtitles(text, from, opts.subFps), opts);
  if (!cues.length) throw new SubtitleError("empty");
  return { text: writeSubtitles(cues, opts.to, opts.subFps), from, encoding, cues: cues.length };
}
