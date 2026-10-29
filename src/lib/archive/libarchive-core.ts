// Reading and writing archives with libarchive's wasm build (from libarchive.js), driven directly
// through its C exports. Runs in a worker in the browser and in Node for tests.

import { gunzipSync } from "fflate";
import { cleanPath, isJunk, MAX_UNPACKED } from "./archive";

/** The emscripten module produced by libarchive.js/src/webworker/wasm-gen/libarchive.js. */
export interface LibarchiveModule {
  HEAPU8: Uint8Array;
  cwrap(name: string, ret: string | null, args: string[]): (...args: unknown[]) => unknown;
}

export interface LaEntry {
  path: string;
  size: number;
  encrypted: boolean;
  data?: Uint8Array;
}

/** Machine-readable failure reason; the UI turns it into localized copy. */
export type LaErrorCode = "password-required" | "password-wrong" | "encryption-unsupported" | "unsupported" | "too-big" | "failed";

export class LaError extends Error {
  constructor(
    readonly code: LaErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function classify(message: string): LaErrorCode {
  if (/incorrect passphrase/i.test(message)) return "password-wrong";
  if (/passphrase (is )?required/i.test(message)) return "password-required";
  if (/encrypt/i.test(message)) return "encryption-unsupported";
  if (/unrecognized archive format|unable to run program|can't initialize filter/i.test(message)) return "unsupported";
  return "failed";
}

/** Archive kinds we can write. 7z is written through a gzip filter and unwrapped (see `write`). */
export type WriteKind = "7z" | "tar.xz" | "tar.bz2";

const FILE = 0o100000;

export function bindLibarchive(M: LibarchiveModule) {
  const f = {
    open: M.cwrap("archive_open", "number", ["number", "number", "string", "string"]) as (p: number, n: number, pw: string | null, locale: string) => number,
    next: M.cwrap("get_next_entry", "number", ["number"]) as (a: number) => number,
    data: M.cwrap("get_filedata", "number", ["number", "number"]) as (a: number, n: number) => number,
    skip: M.cwrap("archive_read_data_skip", "number", ["number"]) as (a: number) => number,
    close: M.cwrap("archive_close", null, ["number"]) as (a: number) => void,
    size: M.cwrap("archive_entry_size", "number", ["number"]) as (e: number) => number,
    name: M.cwrap("archive_entry_pathname_utf8", "string", ["number"]) as (e: number) => string | null,
    type: M.cwrap("archive_entry_filetype", "number", ["number"]) as (e: number) => number,
    encrypted: M.cwrap("archive_entry_is_encrypted", "number", ["number"]) as (e: number) => number,
    error: M.cwrap("archive_error_string", "string", ["number"]) as (a: number) => string | null,
    startWrite: M.cwrap("start_archive_write", "number", ["string", "string", "number", "number", "number", "string"]) as (
      filter: string,
      format: string,
      buf: number,
      cap: number,
      outSize: number,
      pw: string | null,
    ) => number,
    writeFile: M.cwrap("write_archive_file", null, ["number", "string", "number", "number"]) as (a: number, path: string, n: number, p: number) => void,
    finishWrite: M.cwrap("finish_archive_write", "number", ["number", "number"]) as (a: number, outSize: number) => number,
    malloc: M.cwrap("malloc", "number", ["number"]) as (n: number) => number,
    free: M.cwrap("free", null, ["number"]) as (p: number) => void,
  };

  const copyIn = (bytes: Uint8Array) => {
    const p = f.malloc(Math.max(1, bytes.length));
    if (!p) throw new LaError("too-big", "Not enough memory to open this archive");
    M.HEAPU8.set(bytes, p);
    return p;
  };

  /**
   * Walks the archive once. Regular files for which `want(path)` is true are decompressed,
   * everything else is only listed. Throws LaError on bad passwords, unsupported formats etc.
   */
  function read(bytes: Uint8Array, opts: { password?: string; want?: (path: string) => boolean; limit?: number } = {}): LaEntry[] {
    const limit = opts.limit ?? MAX_UNPACKED;
    const ptr = copyIn(bytes);
    const a = f.open(ptr, bytes.length, opts.password || null, "en_US.UTF-8");
    try {
      const openError = f.error(a);
      if (openError) throw new LaError(classify(openError), openError);
      const out: LaEntry[] = [];
      let total = 0;
      for (;;) {
        const e = f.next(a);
        if (!e) {
          const err = f.error(a);
          if (err) throw new LaError(classify(err), err);
          break;
        }
        const raw = f.name(e) ?? "";
        const path = cleanPath(raw);
        if (f.type(e) !== FILE || !path || isJunk(path)) {
          f.skip(a);
          continue;
        }
        const entry: LaEntry = { path, size: f.size(e), encrypted: f.encrypted(e) > 0 };
        if (opts.want?.(path)) {
          total += entry.size;
          if (total > limit) throw new LaError("too-big", `This archive unpacks to more than ${Math.round(limit / 1024 ** 2).toLocaleString("en")} MB, which is over the safety limit`);
          const d = f.data(a, entry.size);
          if (d < 0) {
            const err = f.error(a) ?? "Could not extract";
            throw new LaError(classify(err), err);
          }
          entry.data = M.HEAPU8.slice(d, d + entry.size);
          f.free(d);
        } else {
          f.skip(a);
        }
        out.push(entry);
      }
      return out;
    } finally {
      f.close(a);
      f.free(ptr);
    }
  }

  function write(files: { path: string; data: Uint8Array }[], kind: WriteKind): Uint8Array {
    // libarchive.js can't pass "no filter" (not a valid filter name), so 7z goes through gzip
    // and is unwrapped below. The output buffer is fixed-size: leave room for incompressible
    // data (LZMA grows random input by ~1.5%) plus headers.
    const [format, filter] = kind === "7z" ? ["7zip", "gzip"] : kind === "tar.xz" ? ["paxr", "xz"] : ["paxr", "bzip2"];
    const total = files.reduce((n, x) => n + x.data.length, 0);
    const cap = Math.ceil(total * 1.05) + 65536 + files.length * 1024;
    const buf = f.malloc(cap);
    const outSize = f.malloc(8);
    if (!buf || !outSize) throw new LaError("too-big", "Not enough memory to create this archive");
    try {
      const a = f.startWrite(filter, format, buf, cap, outSize, null);
      for (const x of files) {
        const p = copyIn(x.data);
        f.writeFile(a, x.path, x.data.length, p);
        f.free(p);
      }
      const n = f.finishWrite(a, outSize);
      if (n < 0) throw new LaError("failed", f.error(a) ?? "Could not create the archive");
      const out = M.HEAPU8.slice(buf, buf + n);
      return kind === "7z" ? gunzipSync(out) : out;
    } finally {
      f.free(buf);
      f.free(outSize);
    }
  }

  return { read, write };
}
