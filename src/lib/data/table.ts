// Spreadsheet-shaped data: read XLSX/XLS/ODS/CSV/TSV/JSON/HTML/XML into sheets of
// rows, write them back out as any of the table formats. SheetJS and yaml load on demand.

import { splitName } from "../files";
import { decodeText, parseCsv, writeCsv } from "./csv";
import { elementToJson, escapeXml, inferNumber, isPlainObject, parseJson, parseXmlDocument, xmlName } from "./structured";

export type Cell = string | number | boolean | Date | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export type TableFormat = "xlsx" | "ods" | "csv" | "tsv" | "json" | "html" | "md" | "xml" | "yaml" | "sql";
/** first: only the first sheet · each: one file per sheet · combined: all sheets in one file when the format allows it. */
export type SheetMode = "first" | "each" | "combined";

export const TABLE_FORMATS: Record<TableFormat, { label: string; ext: string; mime: string; multi: boolean }> = {
  xlsx: { label: "XLSX", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", multi: true },
  csv: { label: "CSV", ext: "csv", mime: "text/csv;charset=utf-8", multi: false },
  tsv: { label: "TSV", ext: "tsv", mime: "text/tab-separated-values;charset=utf-8", multi: false },
  json: { label: "JSON", ext: "json", mime: "application/json", multi: true },
  ods: { label: "ODS", ext: "ods", mime: "application/vnd.oasis.opendocument.spreadsheet", multi: true },
  html: { label: "HTML", ext: "html", mime: "text/html;charset=utf-8", multi: true },
  md: { label: "Markdown", ext: "md", mime: "text/markdown;charset=utf-8", multi: true },
  xml: { label: "XML", ext: "xml", mime: "application/xml", multi: true },
  yaml: { label: "YAML", ext: "yaml", mime: "application/yaml", multi: true },
  sql: { label: "SQL", ext: "sql", mime: "application/sql;charset=utf-8", multi: true },
};

export const TABLE_ACCEPT = ".xlsx,.xlsm,.xlsb,.xls,.ods,.fods,.numbers,.csv,.tsv,.tab,.txt,.json,.jsonl,.ndjson,.html,.htm,.xml";

// ---------- cells ----------

/** CSV/HTML text → cell: safe numbers become numbers, the rest stays text. */
export const inferCell = (s: string): Cell => inferNumber(s);

/** Spreadsheet dates are zone-less, so they're kept as "UTC wall-clock" Dates and printed without a zone. */
export function isoDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const s = d.toISOString();
  return s.endsWith("T00:00:00.000Z") ? s.slice(0, 10) : s.slice(0, 19);
}

export function cellText(v: Cell): string {
  if (v === null) return "";
  if (v instanceof Date) return isoDate(v);
  return String(v);
}

const plain = (v: Cell | undefined): string | number | boolean | null => (v === undefined ? null : v instanceof Date ? isoDate(v) : v);

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  return JSON.stringify(v);
}

/** { a: { b: 1 } } → { "a.b": 1 }; arrays are kept as JSON text. */
export function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, Cell> = {}): Record<string, Cell> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length) flatten(v, key, out);
    else out[key] = toCell(v);
  }
  return out;
}

/** Array of arrays → rows as-is; array of objects → header (union of keys, first-seen order) + rows. */
export function recordsToRows(list: unknown[]): Cell[][] {
  if (list.every(Array.isArray)) return list.map((r) => r.map(toCell));
  const keys: string[] = [];
  const seen = new Set<string>();
  const flat = list.map((item) => {
    const rec = isPlainObject(item) ? flatten(item) : { value: toCell(item) };
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
    return rec;
  });
  return [keys, ...flat.map((r) => keys.map((k) => r[k] ?? null))];
}

/** Array → one sheet; object whose values are all arrays → one sheet per key; any other object → one row. */
export function jsonToSheets(data: unknown, name: string): Sheet[] {
  if (Array.isArray(data)) return [{ name, rows: recordsToRows(data) }];
  if (isPlainObject(data)) {
    const entries = Object.entries(data);
    if (entries.length && entries.every(([, v]) => Array.isArray(v))) return entries.map(([k, v]) => ({ name: k, rows: recordsToRows(v as unknown[]) }));
    return [{ name, rows: recordsToRows([data]) }];
  }
  throw new Error("JSON must be an array of objects, an array of arrays, or an object of such arrays");
}

// ---------- reading ----------

function parseJsonOrLines(text: string): unknown {
  try {
    return parseJson(text);
  } catch (e) {
    // JSON Lines: one value per line.
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 1) {
      try {
        return lines.map((l) => JSON.parse(l));
      } catch {
        // fall through to the original, more precise error
      }
    }
    throw e;
  }
}

function htmlToSheets(html: string, base: string): Sheet[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = Array.from(doc.querySelectorAll("table"));
  if (!tables.length) throw new Error("No <table> found in this HTML file");
  return tables.map((table, i) => {
    const rows: Cell[][] = [];
    for (const tr of Array.from(table.querySelectorAll("tr"))) {
      if (tr.closest("table") !== table) continue; // rows of nested tables
      const row: Cell[] = [];
      for (const cell of Array.from(tr.children)) {
        if (cell.tagName !== "TD" && cell.tagName !== "TH") continue;
        row.push(inferCell((cell.textContent ?? "").replace(/\s+/g, " ").trim()));
        const span = Number(cell.getAttribute("colspan")) || 1;
        for (let k = 1; k < Math.min(span, 1000); k++) row.push(null);
      }
      if (row.length) rows.push(row);
    }
    const caption = table.querySelector("caption")?.textContent?.trim();
    return { name: caption || (tables.length > 1 ? `${base} ${i + 1}` : base), rows };
  });
}

/** Repeating elements of an XML file as records: <rows><row><a>1</a></row>…</rows>. */
function xmlToSheet(text: string, name: string): Sheet {
  let parent: Element = parseXmlDocument(text).documentElement;
  // Walk down wrappers like <data><records><record/>…</records></data> to the element that holds the records.
  while (parent.children.length === 1 && Array.from(parent.children[0].children).some((c) => c.children.length > 0)) parent = parent.children[0];
  const records = Array.from(parent.children);
  if (!records.length) throw new Error("This XML has no repeating elements to turn into rows");
  return { name, rows: recordsToRows(records.map(elementToJson)) };
}

async function readWorkbook(bytes: Uint8Array, isoDates: boolean): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellDates: true, dense: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const data = (ws["!data"] ?? []) as (XLSXCell | undefined)[][];
    const rows: Cell[][] = [];
    if (ws["!ref"]) {
      const { s, e } = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = s.r; r <= e.r; r++) {
        const src = data[r];
        const row: Cell[] = [];
        for (let c = s.c; c <= e.c; c++) row.push(readCell(src?.[c], isoDates));
        while (row.length && row[row.length - 1] === null) row.pop();
        if (row.length) rows.push(row);
      }
    }
    return { name, rows };
  });
}

interface XLSXCell {
  t: string;
  v?: unknown;
  w?: string;
}

function readCell(cell: XLSXCell | undefined, isoDates: boolean): Cell {
  if (!cell || cell.v === undefined || cell.t === "z") return null;
  if (cell.t === "d") return isoDates ? (cell.v as Date) : (cell.w ?? isoDate(cell.v as Date));
  if (cell.t === "e") return cell.w ?? "#ERROR";
  if (cell.t === "s") return cell.v === "" ? null : String(cell.v);
  return cell.v as number | boolean;
}

const SPREADSHEET_EXT = new Set(["xlsx", "xlsm", "xlsb", "xls", "ods", "fods", "numbers"]);

type InputKind = "sheet" | "csv" | "tsv" | "json" | "html" | "xml";

function detectKind(ext: string, bytes: Uint8Array, text: () => string): InputKind {
  if (SPREADSHEET_EXT.has(ext)) return "sheet";
  if (ext === "tsv" || ext === "tab") return "tsv";
  if (ext === "csv") return "csv";
  if (ext === "json" || ext === "jsonl" || ext === "ndjson") return "json";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "xml") return "xml";
  // Unknown extension: sniff. ZIP (xlsx/ods) or OLE (xls) containers are workbooks.
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) return "sheet";
  const head = text().slice(0, 65536).trimStart();
  if (head.startsWith("[") || head.startsWith("{")) return "json";
  if (head.startsWith("<")) return /<table[\s>]/i.test(head) ? "html" : "xml";
  return "csv";
}

/** Reads any supported input into sheets. With isoDates off, dates keep the text the spreadsheet shows. */
export async function readTables(name: string, bytes: Uint8Array, isoDates = true): Promise<Sheet[]> {
  const { base, ext } = splitName(name);
  let decoded: string | null = null;
  const text = () => (decoded ??= decodeText(bytes));
  switch (detectKind(ext, bytes, text)) {
    case "sheet":
      return readWorkbook(bytes, isoDates);
    case "json":
      return jsonToSheets(parseJsonOrLines(text()), base);
    case "html":
      return htmlToSheets(text(), base);
    case "xml":
      return [xmlToSheet(text(), base)];
    case "tsv":
      return [{ name: base, rows: parseCsv(text(), "\t").map((r) => r.map(inferCell)) }];
    case "csv":
      return [{ name: base, rows: parseCsv(text()).map((r) => r.map(inferCell)) }];
  }
}

// ---------- writing ----------

export interface TableWriteOptions {
  to: TableFormat;
  /** Treat the first row as column names (JSON keys, <th>, XML tags, SQL columns). */
  header: boolean;
  delimiter: string;
  quoteAll: boolean;
  bom: boolean;
  pretty: boolean;
  /** SQL table name; empty = sheet / file name. */
  table: string;
}

const widthOf = (rows: Cell[][]) => rows.reduce((m, r) => Math.max(m, r.length), 0);
const pad = (r: Cell[], width: number): Cell[] => (r.length >= width ? r : [...r, ...Array<Cell>(width - r.length).fill(null)]);

/** A, B, … Z, AA, AB … */
export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function shape(rows: Cell[][], header: boolean) {
  const width = widthOf(rows);
  if (!header || !rows.length) return { keys: null, body: rows, width };
  const seen = new Map<string, number>();
  const keys = Array.from({ length: width }, (_, i) => {
    const k = cellText(rows[0][i] ?? null).trim() || `column${i + 1}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k}_${n}` : k;
  });
  return { keys, body: rows.slice(1), width };
}

/** Header → array of objects, no header → array of arrays. */
function records(rows: Cell[][], header: boolean): unknown[] {
  const { keys, body, width } = shape(rows, header);
  if (!keys) return body.map((r) => pad(r, width).map(plain));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, plain(r[i])])));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toHtml(sheets: Sheet[], header: boolean, title: string): string {
  const tables = sheets.map((s) => {
    const { keys, body, width } = shape(s.rows, header);
    const caption = sheets.length > 1 ? `\n<caption>${escapeHtml(s.name)}</caption>` : "";
    const head = keys ? `\n<thead>\n<tr>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join("")}</tr>\n</thead>` : "";
    const rows = body.map((r) => `<tr>${pad(r, width).map((v) => `<td${typeof v === "number" ? ' class="n"' : ""}>${escapeHtml(cellText(v))}</td>`).join("")}</tr>`);
    return `<table>${caption}${head}\n<tbody>\n${rows.join("\n")}\n</tbody>\n</table>`;
  });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#1d1c1a}
table{border-collapse:collapse;margin:0 0 32px}
caption{text-align:left;font-weight:600;padding:0 0 8px}
th,td{border:1px solid #d6d3cc;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f3f1ec}
td.n{text-align:right;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
${tables.join("\n")}
</body>
</html>
`;
}

function toMarkdown(sheets: Sheet[], header: boolean): string {
  const esc = (v: Cell) => cellText(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  return sheets
    .map((s) => {
      const { keys, body, width } = shape(s.rows, header);
      const head = keys ?? Array.from({ length: width }, (_, i) => columnLetter(i));
      const lines = [
        `| ${head.map((h) => esc(h)).join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...body.map((r) => `| ${pad(r, width).map(esc).join(" | ")} |`),
      ];
      return (sheets.length > 1 ? `## ${s.name}\n\n` : "") + lines.join("\n");
    })
    .join("\n\n") + "\n";
}

function toXml(sheets: Sheet[], header: boolean): string {
  const rowsXml = (s: Sheet, depth: string) => {
    const { keys, body, width } = shape(s.rows, header);
    const tags = (keys ?? Array.from({ length: width }, (_, i) => columnLetter(i))).map(xmlName);
    return body
      .map((r) => {
        const cells = pad(r, width).map((v, i) => (v === null ? `${depth}  <${tags[i]}/>` : `${depth}  <${tags[i]}>${escapeXml(cellText(v))}</${tags[i]}>`));
        return `${depth}<row>\n${cells.join("\n")}\n${depth}</row>`;
      })
      .join("\n");
  };
  const body =
    sheets.length > 1
      ? `<workbook>\n${sheets.map((s) => `  <sheet name="${escapeXml(s.name, true)}">\n${rowsXml(s, "    ")}\n  </sheet>`).join("\n")}\n</workbook>`
      : `<rows>\n${rowsXml(sheets[0], "  ")}\n</rows>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

/** ANSI SQL: identifiers in double quotes, strings in single quotes (quotes doubled). */
export function sqlLiteral(v: Cell): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${cellText(v).replace(/'/g, "''")}'`;
}

export const sqlIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

function toSql(sheets: Sheet[], header: boolean, table: string): string {
  return sheets
    .map((s) => {
      const { keys, body, width } = shape(s.rows, header);
      const cols = keys ? ` (${keys.map(sqlIdent).join(", ")})` : "";
      const target = sqlIdent(table.trim() || s.name);
      const lines = body.map((r) => `INSERT INTO ${target}${cols} VALUES (${pad(r, width).map(sqlLiteral).join(", ")});`);
      return (sheets.length > 1 ? `-- ${s.name.replace(/\r?\n/g, " ")}\n` : "") + lines.join("\n");
    })
    .join("\n\n") + "\n";
}

/** Excel sheet names: max 31 chars, no : \ / ? * [ ], unique (case-insensitive). */
function sheetName(name: string, used: Set<string>): string {
  const clean = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = clean;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${clean.slice(0, 31 - ` (${n})`.length)} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

async function toWorkbook(sheets: Sheet[], bookType: "xlsx" | "ods"): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(
      s.rows.map((r) => r.map((v) => (v === "" ? null : v))),
      { cellDates: true, UTC: true },
    );
    // Dates show as 2024-01-15 (plus the time when there is one) instead of the US default m/d/yy.
    s.rows.forEach((r, ri) =>
      r.forEach((v, ci) => {
        if (!(v instanceof Date)) return;
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
        if (cell) cell.z = isoDate(v).length > 10 ? "yyyy-mm-dd hh:mm:ss" : "yyyy-mm-dd";
      }),
    );
    // Column widths from the first 1000 rows, so the file opens readable.
    const width = widthOf(s.rows);
    const sample = s.rows.slice(0, 1000);
    ws["!cols"] = Array.from({ length: width }, (_, c) => ({
      wch: Math.min(60, Math.max(8, ...sample.map((r) => cellText(r[c] ?? null).length + 2))),
    }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(s.name, used));
  }
  return XLSX.write(wb, { type: "array", bookType, compression: true }) as Uint8Array;
}

/** Writes one file holding `sheets` (one sheet unless the format can hold several). */
export async function writeTables(sheets: Sheet[], o: TableWriteOptions, title = sheets[0]?.name ?? ""): Promise<Blob> {
  const { mime } = TABLE_FORMATS[o.to];
  const text = (s: string) => new Blob([s], { type: mime });
  switch (o.to) {
    case "xlsx":
    case "ods":
      return new Blob([(await toWorkbook(sheets, o.to)) as BlobPart], { type: mime });
    case "csv":
    case "tsv": {
      const rows = sheets[0].rows;
      const width = widthOf(rows);
      const delimiter = o.to === "tsv" ? "\t" : o.delimiter;
      return text(writeCsv(rows.map((r) => pad(r, width).map(cellText)), { delimiter, quoteAll: o.quoteAll, bom: o.bom }));
    }
    case "json":
    case "yaml": {
      const data = sheets.length > 1 ? Object.fromEntries(sheets.map((s) => [s.name, records(s.rows, o.header)])) : records(sheets[0].rows, o.header);
      if (o.to === "json") return text(JSON.stringify(data, null, o.pretty ? 2 : undefined) + (o.pretty ? "\n" : ""));
      const { stringify } = await import("yaml");
      return text(stringify(data, { lineWidth: 0 }));
    }
    case "html":
      return text(toHtml(sheets, o.header, title));
    case "md":
      return text(toMarkdown(sheets, o.header));
    case "xml":
      return text(toXml(sheets, o.header));
    case "sql":
      return text(toSql(sheets, o.header, o.table));
  }
}

export interface TableOptions extends TableWriteOptions {
  sheets: SheetMode;
  isoDates: boolean;
}

const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "sheet";

/** The sheet mode that actually applies: CSV/TSV can't hold several sheets, so "combined" means one file per sheet. */
export const effectiveMode = (mode: SheetMode, to: TableFormat): SheetMode => (mode === "combined" && !TABLE_FORMATS[to].multi ? "each" : mode);

/** Reads one input file and writes it in the target format. Returns the parsed sheets too (for previews). */
export async function convertTable(
  name: string,
  bytes: Uint8Array,
  o: TableOptions,
): Promise<{ outputs: { name: string; blob: Blob; rows: number }[]; sheets: Sheet[] }> {
  const sheets = (await readTables(name, bytes, o.isoDates)).filter((s) => s.rows.length);
  if (!sheets.length) throw new Error("No data found in this file");
  const mode = effectiveMode(o.sheets, o.to);
  const groups = mode === "first" ? [[sheets[0]]] : mode === "each" ? sheets.map((s) => [s]) : [sheets];
  const { base } = splitName(name);
  const { ext } = TABLE_FORMATS[o.to];
  const outputs = await Promise.all(
    groups.map(async (g) => ({
      name: groups.length > 1 ? `${base} - ${safeFileName(g[0].name)}.${ext}` : `${base}.${ext}`,
      blob: await writeTables(g, o, base),
      // Data rows, not counting header rows.
      rows: g.reduce((a, sh) => a + Math.max(0, sh.rows.length - (o.header ? 1 : 0)), 0),
    })),
  );
  return { outputs, sheets };
}
