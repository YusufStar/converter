import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import factory from "libarchive.js/src/webworker/wasm-gen/libarchive.js";
import { bindLibarchive, classify, LaError } from "./libarchive-core";

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "../../../e2e/fixtures", name)));
const dec = (b?: Uint8Array) => new TextDecoder().decode(b);
const enc = (s: string) => new TextEncoder().encode(s);
const la = bindLibarchive(await factory({ print() {}, printErr() {} }));
const all = () => true;

describe("libarchive read", () => {
  it("lists a 7z without decompressing, then extracts it", () => {
    const list = la.read(fixture("archive-sample.7z"));
    expect(list.map((e) => [e.path.normalize("NFC"), e.size, e.data])).toEqual([
      ["docs/readme.md", 10, undefined],
      ["ğüşıöç.txt", 15, undefined],
    ]);
    const files = la.read(fixture("archive-sample.7z"), { want: all });
    expect(files.map((e) => dec(e.data))).toEqual(["# Merhaba\n", "Merhaba dünya\n"]);
  });

  it("extracts only the wanted file", () => {
    const files = la.read(fixture("archive-sample.7z"), { want: (p) => p.endsWith(".txt") });
    expect(files.map((e) => [e.path.normalize("NFC"), e.data && dec(e.data)])).toEqual([
      ["docs/readme.md", undefined],
      ["ğüşıöç.txt", "Merhaba dünya\n"],
    ]);
  });

  it("reads RAR4 and RAR5, skipping folders and symlinks", () => {
    const rar4 = la.read(fixture("archive-libarchive-rar4.rar"), { want: all });
    expect(rar4.map((e) => [e.path, dec(e.data)])).toEqual([
      ["test.txt", "test text document\r\n"],
      ["testdir/test.txt", "test text document\r\n"],
    ]);
    const rar5 = la.read(fixture("archive-libarchive-rar5.rar"), { want: all });
    expect(rar5.map((e) => [e.path, e.data?.length])).toEqual([["test.bin", 1200]]);
  });

  it("reads tar.xz and tar.bz2", () => {
    for (const name of ["archive-sample.tar.xz", "archive-sample.tar.bz2"]) {
      const files = la.read(fixture(name), { want: all });
      expect(files.map((e) => [e.path.normalize("NFC"), dec(e.data)])).toEqual([
        ["docs/readme.md", "# Merhaba\n"],
        ["ğüşıöç.txt", "Merhaba dünya\n"],
      ]);
    }
  });

  it("asks for the password of an AES zip, rejects a wrong one and accepts the right one", () => {
    const zip = fixture("archive-locked.zip");
    expect(la.read(zip).every((e) => e.encrypted)).toBe(true);
    expect(() => la.read(zip, { want: all })).toThrow(expect.objectContaining({ code: "password-required" }));
    expect(() => la.read(zip, { want: all, password: "nope" })).toThrow(expect.objectContaining({ code: "password-wrong" }));
    expect(la.read(zip, { want: all, password: "gizli" }).map((e) => dec(e.data))).toEqual(["# Merhaba\n", "Merhaba dünya\n"]);
  });

  it("flags encrypted 7z content as unsupported", () => {
    const sz = fixture("archive-locked.7z");
    expect(la.read(sz)[0].encrypted).toBe(true);
    expect(() => la.read(sz, { want: all, password: "gizli" })).toThrow(expect.objectContaining({ code: "encryption-unsupported" }));
  });

  it("refuses unknown data and enforces the size limit", () => {
    expect(() => la.read(enc("just some text, not an archive"))).toThrow(expect.objectContaining({ code: "unsupported" }));
    expect(() => la.read(fixture("archive-sample.7z"), { want: all, limit: 12 })).toThrow(LaError);
  });
});

describe("libarchive write", () => {
  const random = new Uint8Array(300_000);
  for (let i = 0; i < random.length; i += 65536) crypto.getRandomValues(random.subarray(i, i + 65536));
  const files = [
    { path: "klasör/ğüşıöç.txt", data: enc("Merhaba dünya\n".repeat(40)) },
    { path: "noise.bin", data: random },
  ];

  it.each(["7z", "tar.xz", "tar.bz2"] as const)("round-trips a %s, including incompressible data", (kind) => {
    const out = la.write(files, kind);
    if (kind === "7z") expect([...out.subarray(0, 6)]).toEqual([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    if (kind === "tar.xz") expect(dec(out.subarray(1, 5))).toBe("7zXZ");
    if (kind === "tar.bz2") expect(dec(out.subarray(0, 3))).toBe("BZh");
    const back = la.read(out, { want: all });
    expect(back.map((e) => e.path)).toEqual(["klasör/ğüşıöç.txt", "noise.bin"]);
    expect(dec(back[0].data)).toBe("Merhaba dünya\n".repeat(40));
    expect(back[1].data).toEqual(random);
  });
});

describe("classify", () => {
  it("maps libarchive messages to codes", () => {
    expect(classify("Incorrect passphrase")).toBe("password-wrong");
    expect(classify("Passphrase required for this entry")).toBe("password-required");
    expect(classify("RAR encryption support unavailable.")).toBe("encryption-unsupported");
    expect(classify("Unrecognized archive format")).toBe("unsupported");
    expect(classify("Truncated input")).toBe("failed");
  });
});
