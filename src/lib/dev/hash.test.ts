import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatDigest, formatSums, matchDigest, parseExpected } from "./hash";
import { hashBlob } from "./hash-stream";

const hex = (b: Uint8Array | undefined) => Buffer.from(b!).toString("hex");

describe("hashBlob", () => {
  it("matches known vectors", async () => {
    const d = await hashBlob(new Blob(["123456789"]), ["crc32", "md5", "sha1"]);
    expect(hex(d.crc32)).toBe("cbf43926");
    expect(hex(d.md5)).toBe("25f9e794323b453885f5181f1b624d0b");
    expect(hex(d.sha1)).toBe("f7c3bc1d808e04732adf679965ccc34ca7ae3441");
    const empty = await hashBlob(new Blob([]), ["xxh64", "blake3", "sha256"]);
    expect(hex(empty.xxh64)).toBe("ef46db3751d8e999");
    expect(hex(empty.blake3)).toBe("af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");
    expect(hex(empty.sha256)).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("streams in chunks with the same result as node:crypto, reporting progress", async () => {
    const data = randomBytes(1_000_003);
    const progress: number[] = [];
    const d = await hashBlob(new Blob([data]), ["md5", "sha1", "sha256", "sha384", "sha512", "sha3-256", "sha3-512"], {
      chunkSize: 65_536,
      onProgress: (p) => progress.push(p),
    });
    for (const [algo, node] of [
      ["md5", "md5"],
      ["sha1", "sha1"],
      ["sha256", "sha256"],
      ["sha384", "sha384"],
      ["sha512", "sha512"],
      ["sha3-256", "sha3-256"],
      ["sha3-512", "sha3-512"],
    ] as const)
      expect(hex(d[algo]), algo).toBe(createHash(node).update(data).digest("hex"));
    expect(progress.length).toBe(Math.ceil(data.length / 65_536));
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("stops on abort", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(hashBlob(new Blob([new Uint8Array(10)]), ["md5"], { signal: ctrl.signal })).rejects.toThrow("Cancelled");
  });
});

describe("expected hash matching", () => {
  const sha = createHash("sha256").update("abc").digest();
  const md5 = createHash("md5").update("abc").digest();

  it("formats hex, upper hex and base64", () => {
    expect(formatDigest(new Uint8Array([0xab, 0x01]), "hex")).toBe("ab01");
    expect(formatDigest(new Uint8Array([0xab, 0x01]), "HEX")).toBe("AB01");
    expect(formatDigest(new Uint8Array(sha), "base64")).toBe(sha.toString("base64"));
  });

  it("compares only digests of the same length, hex or base64, any case", () => {
    const exp = parseExpected(`  ${sha.toString("hex").toUpperCase()}  `);
    expect(matchDigest(exp, new Uint8Array(sha))).toBe("match");
    expect(matchDigest(exp, new Uint8Array(32))).toBe("mismatch");
    expect(matchDigest(exp, new Uint8Array(md5))).toBeNull();
    expect(matchDigest(parseExpected(sha.toString("base64")), new Uint8Array(sha))).toBe("match");
    expect(parseExpected("not a hash")).toEqual([]);
  });

  it("reads GNU and BSD checksum files and matches by file name", () => {
    const exp = parseExpected(`# comment\n${sha.toString("hex")}  dir/a.txt\n${"00".repeat(32)} *b.txt\nSHA256 (c.txt) = ${sha.toString("hex")}\n`);
    expect(exp.map((e) => e.name)).toEqual(["dir/a.txt", "b.txt", "c.txt"]);
    expect(matchDigest(exp, new Uint8Array(sha), "a.txt")).toBe("match");
    expect(matchDigest(exp, new Uint8Array(sha), "b.txt")).toBe("mismatch");
    expect(matchDigest(exp, new Uint8Array(sha), "c.txt")).toBe("match");
    // A named list says nothing about other files.
    expect(matchDigest(exp, new Uint8Array(sha), "other.txt")).toBeNull();
  });

  it("exports sha256sum lines, one block per algorithm", () => {
    const rows = [{ name: "a.txt", digests: { sha256: new Uint8Array(sha), md5: new Uint8Array(md5) } }];
    expect(formatSums(rows, ["sha256"])).toBe(`${sha.toString("hex")}  a.txt\n`);
    expect(formatSums(rows, ["md5", "sha256"])).toBe(`# MD5\n${md5.toString("hex")}  a.txt\n\n# SHA-256\n${sha.toString("hex")}  a.txt\n`);
  });
});
