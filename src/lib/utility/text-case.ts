// Case conversions with locale-aware upper/lower ("tr": i ↔ İ, ı ↔ I).

export const CASES = ["upper", "lower", "title", "sentence", "camel", "pascal", "snake", "kebab", "constant", "dot", "alternating"] as const;
export type CaseId = (typeof CASES)[number];

export interface CaseOptions {
  /** Turkish dotted/dotless i rules. */
  turkish?: boolean;
  /** Transliterate to ASCII (ç → c, ğ → g, ı → i, é → e…) in the identifier cases. */
  ascii?: boolean;
}

const CODE_CASES = new Set<CaseId>(["camel", "pascal", "snake", "kebab", "constant", "dot"]);
const SPECIAL: Record<string, string> = { ı: "i", ß: "ss", ø: "o", Ø: "O", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE", ł: "l", Ł: "L", đ: "d", Đ: "D" };

export function toAscii(s: string): string {
  return s
    .replace(/[ıßøØæÆœŒłŁđĐ]/g, (c) => SPECIAL[c])
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

/** Splits identifiers and prose into words: "XMLHttpRequest v2_final" → [XML, Http, Request, v2, final]. */
export function words(s: string): string[] {
  return s
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function convertCase(text: string, id: CaseId, { turkish = false, ascii = false }: CaseOptions = {}): string {
  // ASCII identifiers must not gain an İ from Turkish upper-casing.
  const loc = turkish && !(ascii && CODE_CASES.has(id)) ? "tr" : "en";
  const up = (s: string) => s.toLocaleUpperCase(loc);
  const low = (s: string) => s.toLocaleLowerCase(loc);
  const cap = (w: string) => {
    const [first = "", ...rest] = Array.from(w);
    return up(first) + low(rest.join(""));
  };

  if (CODE_CASES.has(id)) {
    // One identifier per line, so a pasted list converts item by item.
    return text
      .split(/\r?\n/)
      .map((line) => {
        const ws = words(ascii ? toAscii(line) : line);
        switch (id) {
          case "camel":
            return ws.map((w, i) => (i ? cap(w) : low(w))).join("");
          case "pascal":
            return ws.map(cap).join("");
          case "snake":
            return ws.map(low).join("_");
          case "kebab":
            return ws.map(low).join("-");
          case "constant":
            return ws.map(up).join("_");
          default:
            return ws.map(low).join(".");
        }
      })
      .join("\n");
  }

  switch (id) {
    case "upper":
      return up(text);
    case "lower":
      return low(text);
    case "title":
      return text.replace(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu, cap);
    case "sentence":
      return low(text).replace(/(^|[.!?…]\s+|\n\s*)(\p{L})/gu, (_, pre: string, ch: string) => pre + up(ch));
    case "alternating": {
      let i = 0;
      return Array.from(text, (ch) => (/\p{L}/u.test(ch) ? (i++ % 2 ? up(ch) : low(ch)) : ch)).join("");
    }
    default:
      return text;
  }
}

export interface TextStats {
  characters: number;
  noSpaces: number;
  words: number;
  sentences: number;
  lines: number;
  bytes: number;
}

export function textStats(text: string, lang = "en"): TextStats {
  const graphemes = Array.from(new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  let wordCount = 0;
  for (const s of new Intl.Segmenter(lang, { granularity: "word" }).segment(text)) if (s.isWordLike) wordCount++;
  let sentences = 0;
  for (const s of new Intl.Segmenter(lang, { granularity: "sentence" }).segment(text)) if (/[\p{L}\p{N}]/u.test(s.segment)) sentences++;
  return {
    characters: graphemes.length,
    noSpaces: graphemes.filter((g) => !/^\s+$/u.test(g)).length,
    words: wordCount,
    sentences,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    bytes: new TextEncoder().encode(text).length,
  };
}
