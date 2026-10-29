// ZIP / GZIP / TAR in the browser with fflate (loaded on demand) and a small tar reader.

import { splitName } from "../files";

/** Hard cap on what one archive may unpack to; protects the tab from zip bombs. */
export const MAX_UNPACKED = 2 * 1024 ** 3;

export interface Entry {
  /** Clean relative path, e.g. "docs/readme.txt". */
  path: string;
  data: Uint8Array;
  mtime?: Date;
}

const tooBig = (limit: number) =>
  new Error(`This archive unpacks to more than ${Math.round(limit / 1024 ** 2).toLocaleString("en")} MB, which is over the safety limit`);

/**
 * "../a//./b\\c.txt" → "a/b/c.txt". Drops absolute/drive prefixes and ".." so a
 * re-zipped download can never write outside its folder (zip slip).
 */
export function cleanPath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== "." && s !== ".." && !/^[a-z]:$/i.test(s))
    .join("/");
}

/** macOS resource forks and Finder files are noise for everyone else. */
const isJunk = (path: string) => path.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(path);

// ---------- ZIP ----------

export interface ZipInput {
  name: string;
  data: Uint8Array;
  mtime?: Date;
}

/** level 0 = store, 1 = fast, 9 = smallest. Duplicate names must already be unique. */
export async function zipEntries(files: ZipInput[], level: 0 | 1 | 6 | 9): Promise<Uint8Array> {
  const { zip } = await import("fflate");
  const input: Record<string, [Uint8Array, { level: 0 | 1 | 6 | 9; mtime?: Date }]> = {};
  // ZIP timestamps only cover 1980–2099; anything else falls back to "now".
  const ok = (d?: Date) => (d && d.getFullYear() >= 1980 && d.getFullYear() < 2100 ? d : undefined);
  for (const f of files) input[f.name] = [f.data, { level, mtime: ok(f.mtime) }];
  return new Promise((resolve, reject) => zip(input, (err, out) => (err ? reject(err) : resolve(out))));
}

export async function unzipEntries(bytes: Uint8Array, limit = MAX_UNPACKED): Promise<Entry[]> {
  const { unzip, unzipSync } = await import("fflate");
  // Pass 1 reads only the central directory: declared sizes and methods, nothing is inflated.
  // fflate allocates exactly the declared size per entry, so the sum bounds memory use.
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (f.compression !== 0 && f.compression !== 8) {
          throw new Error(`"${f.name}" uses an unsupported compression method (${f.compression}). Only Store and Deflate ZIPs can be opened here.`);
        }
        total += f.originalSize;
        if (total > limit) throw tooBig(limit);
        return false;
      },
    });
  } catch (e) {
    if (e instanceof Error && (e.message.includes("safety limit") || e.message.includes("compression method"))) throw e;
    throw new Error(`Not a valid ZIP archive (${e instanceof Error ? e.message : String(e)})`);
  }
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, { filter: (f) => !f.name.endsWith("/") }, (err, out) =>
      err ? reject(new Error(`Could not extract: ${err.message}. The archive may be damaged or password-protected.`)) : resolve(out),
    ),
  );
  return Object.entries(files)
    .map(([name, data]) => ({ path: cleanPath(name), data }))
    .filter((e) => e.path && !isJunk(e.path));
}

// ---------- GZIP ----------

/** Original file name stored in a gzip header (FNAME), if any. */
export function gzipHeaderName(b: Uint8Array): string | undefined {
  if (b.length < 10 || b[0] !== 0x1f || b[1] !== 0x8b) return undefined;
  const flags = b[3];
  if (!(flags & 0x08)) return undefined;
  let p = 10;
  if (flags & 0x04) p += 2 + (b[10] | (b[11] << 8));
  const end = b.indexOf(0, p);
  if (end <= p) return undefined;
  const raw = b.subarray(p, end);
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    name = new TextDecoder("latin1").decode(raw);
  }
  return cleanPath(name).split("/").pop() || undefined;
}

export async function gzipBytes(data: Uint8Array, opts: { level: 1 | 6 | 9; filename?: string; mtime?: Date }): Promise<Uint8Array> {
  const { gzip } = await import("fflate");
  return new Promise((resolve, reject) => gzip(data, opts, (err, out) => (err ? reject(err) : resolve(out))));
}

export async function gunzipBytes(data: Uint8Array, limit = MAX_UNPACKED): Promise<Uint8Array> {
  if (data.length < 18 || data[0] !== 0x1f || data[1] !== 0x8b) throw new Error("Not a gzip file");
  // ISIZE (last 4 bytes) is the unpacked size mod 2^32; fflate allocates it up front.
  const isize = new DataView(data.buffer, data.byteOffset + data.length - 4, 4).getUint32(0, true);
  if (isize > limit) throw tooBig(limit);
  const { gunzip } = await import("fflate");
  return new Promise((resolve, reject) =>
    gunzip(data, (err, out) => (err ? reject(new Error(`Could not decompress: ${err.message}`)) : resolve(out))),
  );
}

/** Name for a decompressed .gz: "a.csv.gz" → "a.csv", "a.tgz" → "a.tar", else the name in the header. */
export function gunzipName(name: string, bytes: Uint8Array): string {
  const { base, ext } = splitName(name);
  if (ext === "tgz") return `${base}.tar`;
  if (ext === "gz" && splitName(base).ext) return base;
  return gzipHeaderName(bytes) ?? (ext === "gz" ? base : `${name}.out`);
}

// ---------- TAR ----------

export const isTar = (b: Uint8Array) => b.length >= 512 && String.fromCharCode(...b.subarray(257, 262)) === "ustar";

/** Reads ustar / GNU / pax tar archives: regular files only, long names supported. */
export function untar(b: Uint8Array, limit = MAX_UNPACKED): Entry[] {
  const dec = new TextDecoder();
  const str = (o: number, n: number) => {
    const s = b.subarray(o, o + n);
    const z = s.indexOf(0);
    return dec.decode(z >= 0 ? s.subarray(0, z) : s);
  };
  const out: Entry[] = [];
  let off = 0;
  let total = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (off + 512 <= b.length && b[off] !== 0) {
    if (b[off + 124] & 0x80) throw tooBig(limit); // base-256 size field: an 8 GB+ member
    const size = parseInt(str(off + 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("Damaged tar archive");
    const type = String.fromCharCode(b[off + 156] || 0x30);
    const prefix = str(off + 257, 6).startsWith("ustar") ? str(off + 345, 155) : "";
    const name = prefix ? `${prefix}/${str(off, 100)}` : str(off, 100);
    const mtime = parseInt(str(off + 136, 12).trim() || "0", 8);
    const start = off + 512;
    const data = b.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = str(start, size);
    } else if (type === "x") {
      // pax records: "<len> key=value\n"
      for (const line of dec.decode(data).split("\n")) {
        const m = /^\d+ path=(.*)$/.exec(line);
        if (m) paxPath = m[1];
      }
    } else if (type === "g") {
      // global pax header: nothing we need
    } else {
      const path = cleanPath(paxPath ?? longName ?? name);
      longName = paxPath = null;
      if ((type === "0" || type === "7") && path && !isJunk(path)) {
        total += size;
        if (total > limit) throw tooBig(limit);
        out.push({ path, data, mtime: mtime ? new Date(mtime * 1000) : undefined });
      }
    }
  }
  return out;
}

/** ZIP, TAR, TAR.GZ / TGZ, or a single .gz file → entries. */
export async function extractArchive(name: string, bytes: Uint8Array, limit = MAX_UNPACKED): Promise<Entry[]> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return unzipEntries(bytes, limit);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const inner = await gunzipBytes(bytes, limit);
    if (isTar(inner)) return untar(inner, limit);
    return [{ path: gunzipName(name, bytes), data: inner }];
  }
  if (isTar(bytes) || splitName(name).ext === "tar") return untar(bytes, limit);
  throw new Error("Unsupported archive. Use ZIP, TAR, TAR.GZ / TGZ or GZ.");
}
