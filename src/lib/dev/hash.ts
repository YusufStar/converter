// Hash generator helpers: algorithm list, digest formatting, "expected hash" matching and
// sha256sum-style export. Pure; the hashing itself lives in hash-stream.ts (hash-wasm).

import { base64ToBytes, bytesToBase64, bytesToHex } from "../utility/encoding";

export type HashAlgo = "md5" | "sha1" | "sha256" | "sha384" | "sha512" | "sha3-256" | "sha3-512" | "crc32" | "xxh64" | "blake3";

export const HASH_ALGOS: { id: HashAlgo; label: string; bytes: number }[] = [
  { id: "md5", label: "MD5", bytes: 16 },
  { id: "sha1", label: "SHA-1", bytes: 20 },
  { id: "sha256", label: "SHA-256", bytes: 32 },
  { id: "sha384", label: "SHA-384", bytes: 48 },
  { id: "sha512", label: "SHA-512", bytes: 64 },
  { id: "sha3-256", label: "SHA3-256", bytes: 32 },
  { id: "sha3-512", label: "SHA3-512", bytes: 64 },
  { id: "crc32", label: "CRC32", bytes: 4 },
  { id: "xxh64", label: "xxHash64", bytes: 8 },
  { id: "blake3", label: "BLAKE3", bytes: 32 },
];

export const algoLabel = (id: HashAlgo) => HASH_ALGOS.find((a) => a.id === id)?.label ?? id;

export type DigestEncoding = "hex" | "HEX" | "base64";

export function formatDigest(bytes: Uint8Array, encoding: DigestEncoding): string {
  if (encoding === "base64") return bytesToBase64(bytes);
  return bytesToHex(bytes, "none", encoding === "HEX");
}

export interface Expected {
  bytes: Uint8Array;
  /** File name when the line came from a checksum file ("hash  name" or "SHA256 (name) = hash"). */
  name?: string;
}

function digestBytes(s: string): Uint8Array | null {
  if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 && s.length >= 8) return Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16));
  try {
    const b = base64ToBytes(s);
    return b.length >= 4 ? b : null;
  } catch {
    return null;
  }
}

/**
 * Reads what the user pasted as "expected": a bare digest (hex or base64), or the lines of a
 * checksum file — GNU (`<hash>  name`, `<hash> *name`) or BSD (`SHA256 (name) = <hash>`).
 */
export function parseExpected(text: string): Expected[] {
  const out: Expected[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const bsd = /^[\w-]+\s*\((.+)\)\s*=\s*(\S+)$/.exec(line);
    const gnu = /^(\S+)\s+\*?(.+)$/.exec(line);
    const [digest, name] = bsd ? [bsd[2], bsd[1]] : gnu ? [gnu[1], gnu[2]] : [line, undefined];
    const bytes = digestBytes(digest);
    if (bytes) out.push({ bytes, name: name?.trim() });
  }
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Match state of one (file, algorithm) row against the expected digests. Only digests of the
 * same length are compared, so pasting one SHA-256 marks the SHA-256 rows and leaves MD5 alone;
 * named lines only apply to the file with that name.
 */
export function matchDigest(expected: Expected[], digest: Uint8Array, fileName?: string): "match" | "mismatch" | null {
  const sameLength = expected.filter((e) => e.bytes.length === digest.length);
  if (!sameLength.length) return null;
  const base = fileName?.split(/[\\/]/).pop();
  const named = sameLength.filter((e) => e.name && e.name.split(/[\\/]/).pop() === base);
  const pool = named.length ? named : sameLength.filter((e) => !e.name);
  if (!pool.length) return null;
  return pool.some((e) => sameBytes(e.bytes, digest)) ? "match" : "mismatch";
}

export interface SumRow {
  name: string;
  digests: Partial<Record<HashAlgo, Uint8Array>>;
}

/**
 * sha256sum-style text (`<hex>  <name>`), so `sha256sum -c` can check it. Several algorithms
 * get one block each under a `# SHA-256` style heading.
 */
export function formatSums(rows: SumRow[], algos: HashAlgo[]): string {
  const block = (a: HashAlgo) =>
    rows
      .filter((r) => r.digests[a])
      .map((r) => `${bytesToHex(r.digests[a]!, "none")}  ${r.name}`)
      .join("\n");
  if (algos.length === 1) return `${block(algos[0])}\n`;
  return `${algos.map((a) => `# ${algoLabel(a)}\n${block(a)}`).join("\n\n")}\n`;
}
