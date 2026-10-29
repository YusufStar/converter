// Streams a Blob/File through hash-wasm hashers in fixed-size chunks, so multi-GB files never
// sit in memory whole. Used by the hash worker (files) and directly for typed text.

import {
  createBLAKE3,
  createCRC32,
  createMD5,
  createSHA1,
  createSHA256,
  createSHA3,
  createSHA384,
  createSHA512,
  createXXHash64,
  type IHasher,
} from "hash-wasm";
import type { HashAlgo } from "./hash";

const FACTORY: Record<HashAlgo, () => Promise<IHasher>> = {
  md5: createMD5,
  sha1: createSHA1,
  sha256: createSHA256,
  sha384: createSHA384,
  sha512: createSHA512,
  "sha3-256": () => createSHA3(256),
  "sha3-512": () => createSHA3(512),
  crc32: () => createCRC32(),
  xxh64: () => createXXHash64(),
  blake3: () => createBLAKE3(),
};

export const CHUNK_SIZE = 4 << 20;

export interface HashOptions {
  chunkSize?: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export async function hashBlob(blob: Blob, algos: HashAlgo[], { chunkSize = CHUNK_SIZE, onProgress, signal }: HashOptions = {}): Promise<Partial<Record<HashAlgo, Uint8Array>>> {
  const hashers = await Promise.all(algos.map((a) => FACTORY[a]()));
  for (const h of hashers) h.init();
  const read = (off: number) => blob.slice(off, off + chunkSize).arrayBuffer();
  // Read the next chunk while the current one is hashed.
  let next = blob.size ? read(0) : null;
  for (let off = 0; next; ) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const bytes = new Uint8Array(await next);
    off += bytes.length;
    next = off < blob.size ? read(off) : null;
    for (const h of hashers) h.update(bytes);
    onProgress?.(off / blob.size);
  }
  return Object.fromEntries(algos.map((a, i) => [a, hashers[i].digest("binary")]));
}
