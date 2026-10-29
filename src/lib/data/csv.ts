// RFC 4180 CSV parsing and writing. Pure string work, no dependencies.

const CANDIDATES = [",", ";", "\t", "|"];

/** Picks the delimiter that occurs most often (outside quotes) in the first line. */
export function detectDelimiter(text: string): string {
  const counts = new Map(CANDIDATES.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  let best = ",";
  for (const d of CANDIDATES) if (counts.get(d)! > counts.get(best)!) best = d;
  return best;
}

/** Parses CSV text into rows of strings. Handles quotes, doubled quotes, CR/LF/CRLF and a leading BOM; blank lines are skipped. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? detectDelimiter(text);
  const n = text.length;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const scan = (from: number) => {
    let k = from;
    while (k < n && text[k] !== d && text[k] !== "\n" && text[k] !== "\r") k++;
    return k;
  };
  for (;;) {
    let field = "";
    if (text[i] === '"') {
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          // Unterminated quote: take the rest of the input as the field.
          field += text.slice(j);
          i = n;
          break;
        }
        field += text.slice(j, q);
        if (text[q + 1] === '"') {
          field += '"';
          j = q + 2;
          continue;
        }
        i = q + 1;
        break;
      }
      // Anything between the closing quote and the next delimiter is kept as-is.
      const k = scan(i);
      field += text.slice(i, k);
      i = k;
    } else {
      const k = scan(i);
      field = text.slice(i, k);
      i = k;
    }
    row.push(field);
    if (i >= n) {
      rows.push(row);
      break;
    }
    if (text[i] === d) {
      i++;
      continue;
    }
    rows.push(row);
    row = [];
    i += text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1;
    if (i >= n) break;
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

export interface CsvWriteOptions {
  delimiter?: string;
  /** Quote every field instead of only the ones that need it. */
  quoteAll?: boolean;
  /** Prefix a UTF-8 byte order mark so Excel detects the encoding. */
  bom?: boolean;
}

export function writeCsv(rows: string[][], { delimiter = ",", quoteAll = false, bom = false }: CsvWriteOptions = {}): string {
  const quote = (s: string) =>
    quoteAll || s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r") ? `"${s.replace(/"/g, '""')}"` : s;
  const body = rows.map((r) => r.map(quote).join(delimiter)).join("\r\n");
  return (bom ? "﻿" : "") + body + (rows.length ? "\r\n" : "");
}

/**
 * Decodes text bytes: UTF-8 (BOM stripped) when valid, otherwise Windows-1254,
 * which is what Turkish Excel saves "CSV" as and is a superset of Latin-1 for most text.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    // TextDecoder drops a leading BOM by default.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1254").decode(bytes);
  }
}
