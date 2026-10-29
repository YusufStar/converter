// JSON / YAML / XML / TOML parsing and printing for the data format converter.
// yaml and smol-toml load on demand; XML uses the platform DOMParser.

import { splitName } from "../files";

export type DataFormat = "json" | "yaml" | "xml" | "toml";
/** Spaces per level, a tab, or 0 for minified output. */
export type Indent = 2 | 4 | "tab" | 0;

export const DATA_FORMATS: Record<DataFormat, { label: string; ext: string; mime: string; exts: string[] }> = {
  json: { label: "JSON", ext: "json", mime: "application/json", exts: ["json", "geojson", "webmanifest"] },
  yaml: { label: "YAML", ext: "yaml", mime: "application/yaml", exts: ["yaml", "yml"] },
  xml: { label: "XML", ext: "xml", mime: "application/xml", exts: ["xml", "svg", "rss", "atom", "plist", "xsd", "xsl"] },
  toml: { label: "TOML", ext: "toml", mime: "application/toml", exts: ["toml"] },
};

export function formatFromName(name: string): DataFormat | null {
  const ext = splitName(name).ext;
  return (Object.keys(DATA_FORMATS) as DataFormat[]).find((f) => DATA_FORMATS[f].exts.includes(ext)) ?? null;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * "42" → 42, "3.5" → 3.5. Strings that would change when printed back
 * (leading zeros, more than 15 digits, "1e5", "+90…") stay text.
 */
export function inferNumber(s: string): string | number {
  return NUMBER.test(s) && s.replace(/[-.]/g, "").length <= 15 ? Number(s) : s;
}

// ---------- JSON ----------

/** 1-based line and column of a string offset. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, col: offset - before.lastIndexOf("\n") };
}

/**
 * Offset of the first JSON syntax error, or -1 if the text is valid.
 * Browsers don't agree on (or always include) a position in JSON.parse errors.
 */
export function jsonErrorOffset(s: string): number {
  let i = 0;
  const fail = (): never => {
    throw i;
  };
  const ws = () => {
    while (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r") i++;
  };
  const literal = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  const str = () => {
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') return void i++;
      if (c === "\\") {
        const e = s[i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) fail();
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else fail();
      } else if (c < " ") fail();
      else i++;
    }
    fail();
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      ws();
      if (s[i] === close) return void i++;
      for (;;) {
        if (c === "{") {
          ws();
          if (s[i] !== '"') fail();
          str();
          ws();
          if (s[i] !== ":") fail();
          i++;
        }
        value();
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === close) return void i++;
        else fail();
      }
    }
    if (c === '"') return str();
    literal.lastIndex = i;
    const m = literal.exec(s);
    if (!m) fail();
    i += m![0].length;
  };
  try {
    value();
    ws();
    if (i < s.length) fail();
    return -1;
  } catch (e) {
    if (typeof e === "number") return e;
    throw e;
  }
}

/** JSON.parse with an error message that names the line and column. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    const at = jsonErrorOffset(text);
    if (at < 0) throw e;
    const { line, col } = lineCol(text, at);
    const found = at >= text.length ? "end of input" : JSON.stringify(text[at]);
    throw new Error(`Invalid JSON at line ${line}, column ${col}: unexpected ${found}`);
  }
}

// ---------- XML ----------

export function parseXmlDocument(text: string): Document {
  const doc = new DOMParser().parseFromString(text.trim(), "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err || !doc.documentElement) {
    const msg = err?.textContent ?? "";
    const m = /line (\d+) at column (\d+):\s*([^\n]+)/i.exec(msg) ?? /line number (\d+), column (\d+):?\s*([^\n]*)/i.exec(msg);
    throw new Error(m ? `Invalid XML at line ${m[1]}, column ${m[2]}: ${m[3].trim()}` : `Invalid XML: ${msg.trim().split("\n")[0] || "could not parse"}`);
  }
  return doc;
}

const inferXml = (s: string): unknown => (s === "true" ? true : s === "false" ? false : inferNumber(s));

/**
 * Element → JSON: attributes become "@name", text next to attributes or
 * children becomes "#text", repeated child elements become arrays.
 */
export function elementToJson(el: Element): unknown {
  const out: Record<string, unknown> = {};
  for (const a of Array.from(el.attributes)) out[`@${a.name}`] = inferXml(a.value);
  const arrays = new Set<string>();
  const kids = Array.from(el.children);
  for (const c of kids) {
    const k = c.tagName;
    const v = elementToJson(c);
    if (!(k in out)) out[k] = v;
    else if (arrays.has(k)) (out[k] as unknown[]).push(v);
    else {
      out[k] = [out[k], v];
      arrays.add(k);
    }
  }
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3 || n.nodeType === 4)
    .map((n) => n.nodeValue)
    .join("")
    .trim();
  if (!kids.length && !el.attributes.length) return inferXml(text);
  if (text) out["#text"] = inferXml(text);
  return out;
}

export function xmlToJson(text: string): unknown {
  const root = parseXmlDocument(text).documentElement;
  return { [root.tagName]: elementToJson(root) };
}

/** Makes any string a valid XML element/attribute name. */
export function xmlName(s: string): string {
  const n = s.replace(/[^\p{L}\p{N}_.:-]/gu, "_");
  return /^[\p{L}_]/u.test(n) ? n : `_${n}`;
}

export function escapeXml(s: string, attr = false): string {
  // Characters that are illegal anywhere in XML 1.0 are dropped.
  const clean = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
  return attr ? clean.replace(/"/g, "&quot;") : clean;
}

const scalarText = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/** The reverse of elementToJson. A single-key object becomes the root element; anything else is wrapped in <root>. */
export function jsonToXml(value: unknown, indent = "  "): string {
  const nl = indent ? "\n" : "";
  const node = (name: string, v: unknown, depth: number): string => {
    const pad = indent.repeat(depth);
    const tag = xmlName(name);
    if (Array.isArray(v)) return v.map((item) => node(name, item, depth)).filter(Boolean).join(nl);
    if (v === null || v === undefined) return `${pad}<${tag}/>`;
    if (!isPlainObject(v)) return `${pad}<${tag}>${escapeXml(scalarText(v))}</${tag}>`;
    let attrs = "";
    let text: unknown = null;
    const kids: string[] = [];
    for (const [k, x] of Object.entries(v)) {
      if (k === "#text") text = x;
      else if (k.startsWith("@") && k.length > 1 && !isPlainObject(x) && !Array.isArray(x)) attrs += ` ${xmlName(k.slice(1))}="${escapeXml(x == null ? "" : scalarText(x), true)}"`;
      else kids.push(node(k, x, depth + 1));
    }
    const body = kids.filter(Boolean);
    if (!body.length) return text == null ? `${pad}<${tag}${attrs}/>` : `${pad}<${tag}${attrs}>${escapeXml(scalarText(text))}</${tag}>`;
    const textLine = text == null ? "" : `${pad}${indent}${escapeXml(scalarText(text))}${nl}`;
    return `${pad}<${tag}${attrs}>${nl}${textLine}${body.join(nl)}${nl}${pad}</${tag}>`;
  };
  const entries = isPlainObject(value) ? Object.entries(value) : [];
  const xml =
    entries.length === 1 && !Array.isArray(entries[0][1])
      ? node(entries[0][0], entries[0][1], 0)
      : Array.isArray(value)
        ? node("root", { item: value }, 0)
        : node("root", value, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>${nl || "\n"}${xml}${nl}`;
}

// ---------- shared ----------

export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (!isPlainObject(v)) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => [k, sortKeysDeep(v[k])]),
  );
}

/** TOML has no null and needs a table at the top: nulls are left out, other roots go under "items". */
function tomlSafe(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => x != null).map(tomlSafe);
  if (!isPlainObject(v)) return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x != null)
      .map(([k, x]) => [k, tomlSafe(x)]),
  );
}

export async function parseData(text: string, from: DataFormat): Promise<unknown> {
  if (!text.trim()) throw new Error("The input is empty");
  switch (from) {
    case "json":
      return parseJson(text);
    case "xml":
      return xmlToJson(text);
    case "yaml": {
      const { parseAllDocuments } = await import("yaml");
      const docs = parseAllDocuments(text);
      const bad = docs.find((d) => d.errors.length);
      if (bad) throw new Error(`Invalid YAML: ${bad.errors[0].message}`);
      return docs.length === 1 ? docs[0].toJS() : docs.map((d) => d.toJS());
    }
    case "toml": {
      const { parse } = await import("smol-toml");
      try {
        return parse(text);
      } catch (e) {
        throw new Error((e as Error).message.replace(/^Invalid TOML document:/, "Invalid TOML:"));
      }
    }
  }
}

export interface StringifyOptions {
  indent: Indent;
  sortKeys: boolean;
}

export async function stringifyData(value: unknown, to: DataFormat, { indent, sortKeys }: StringifyOptions): Promise<string> {
  const v = sortKeys ? sortKeysDeep(value) : value;
  switch (to) {
    case "json":
      return JSON.stringify(v, null, indent === 0 ? undefined : indent === "tab" ? "\t" : indent) + (indent === 0 ? "" : "\n");
    case "xml":
      return jsonToXml(v, indent === 0 ? "" : indent === "tab" ? "\t" : " ".repeat(indent));
    case "yaml": {
      const { stringify } = await import("yaml");
      return stringify(v, { indent: indent === 4 ? 4 : 2, lineWidth: 0 });
    }
    case "toml": {
      const { stringify } = await import("smol-toml");
      return stringify(isPlainObject(v) ? tomlSafe(v) : { items: tomlSafe(v) }) + "\n";
    }
  }
}

export async function convertData(text: string, from: DataFormat, to: DataFormat, opts: StringifyOptions): Promise<string> {
  return stringifyData(await parseData(text, from), to, opts);
}
