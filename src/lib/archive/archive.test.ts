import { describe, expect, it } from "vitest";
import { gzipSync, zipSync } from "fflate";
import { cleanPath, extractArchive, gunzipBytes, gunzipName, gzipBytes, gzipHeaderName, unzipEntries, untar, zipEntries } from "./archive";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** Minimal ustar writer for tests. */
function tar(files: { name: string; data: Uint8Array; type?: string }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const h = new Uint8Array(512);
    const put = (s: string, o: number) => h.set(enc(s), o);
    put(f.name.slice(0, 100), 0);
    put("0000644\0", 100);
    put(f.data.length.toString(8).padStart(11, "0") + "\0", 124);
    put("14712345670\0", 136);
    put("        ", 148);
    put(f.type ?? "0", 156);
    put("ustar\u000000", 257);
    put(
      h.reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ",
      148,
    );
    blocks.push(h, f.data, new Uint8Array((512 - (f.data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

describe("zip", () => {
  it("round-trips files with folders at every level", async () => {
    for (const level of [0, 1, 9] as const) {
      const bytes = await zipEntries(
        [
          { name: "a.txt", data: enc("hello ğüşıöç"), mtime: new Date(2020, 1, 1) },
          { name: "docs/readme.md", data: enc("# hi") },
          { name: "old.txt", data: enc("x"), mtime: new Date(0) },
        ],
        level,
      );
      const entries = await unzipEntries(bytes);
      expect(Object.fromEntries(entries.map((e) => [e.path, dec(e.data)]))).toEqual({ "a.txt": "hello ğüşıöç", "docs/readme.md": "# hi", "old.txt": "x" });
    }
  });

  it("skips folders and macOS junk and cleans unsafe paths", async () => {
    const bytes = zipSync({
      "dir/": new Uint8Array(0),
      "dir/f.txt": enc("f"),
      "__MACOSX/dir/._f.txt": enc("junk"),
      "dir/.DS_Store": enc("junk"),
      "../../evil.txt": enc("e"),
    });
    const entries = await unzipEntries(bytes);
    expect(entries.map((e) => e.path).sort()).toEqual(["dir/f.txt", "evil.txt"]);
    expect(cleanPath("C:\\a\\..\\b/./c.txt")).toBe("a/b/c.txt");
  });

  it("refuses archives that unpack past the limit (zip bomb guard)", async () => {
    const bomb = zipSync({ "zeros.bin": new Uint8Array(5_000_000) }, { level: 9 });
    expect(bomb.length).toBeLessThan(20_000);
    await expect(unzipEntries(bomb, 1_000_000)).rejects.toThrow(/over the safety limit/);
    expect((await unzipEntries(bomb, 10_000_000))[0].data.length).toBe(5_000_000);
  });

  it("rejects non-zip data clearly", async () => {
    await expect(unzipEntries(enc("PK but not really a zip file at all"))).rejects.toThrow(/Not a valid ZIP/);
  });
});

describe("gzip", () => {
  it("round-trips and stores the file name", async () => {
    const data = enc("ad,şehir\nAyşe,İstanbul\n".repeat(100));
    const gz = await gzipBytes(data, { level: 9, filename: "people.csv" });
    expect([gz[0], gz[1]]).toEqual([0x1f, 0x8b]);
    expect(gz.length).toBeLessThan(data.length);
    expect(gzipHeaderName(gz)).toBe("people.csv");
    expect(dec(await gunzipBytes(gz))).toBe(dec(data));
  });

  it("names outputs sensibly", () => {
    const gz = gzipSync(enc("x"), { filename: "inner.json" });
    expect(gunzipName("a.csv.gz", gz)).toBe("a.csv");
    expect(gunzipName("a.tgz", gz)).toBe("a.tar");
    expect(gunzipName("download.gz", gz)).toBe("inner.json");
    expect(gunzipName("download.gz", gzipSync(enc("x")))).toBe("download");
  });

  it("guards against gzip bombs and bad input", async () => {
    const bomb = gzipSync(new Uint8Array(3_000_000), { level: 9 });
    await expect(gunzipBytes(bomb, 1_000_000)).rejects.toThrow(/over the safety limit/);
    await expect(gunzipBytes(enc("not gzip at all, sorry"))).rejects.toThrow("Not a gzip file");
  });
});

describe("tar", () => {
  const long = `deep/${"n".repeat(120)}.txt`;
  const archive = () =>
    tar([
      { name: "dir/", data: new Uint8Array(0), type: "5" },
      { name: "dir/a.txt", data: enc("alpha") },
      { name: "././@LongLink", data: enc(long + "\0"), type: "L" },
      { name: long.slice(0, 100), data: enc("long name") },
      { name: "big.bin", data: new Uint8Array(1500) },
    ]);

  it("reads files, long names and skips directories", () => {
    const entries = untar(archive());
    expect(entries.map((e) => [e.path, e.data.length])).toEqual([
      ["dir/a.txt", 5],
      [long, 9],
      ["big.bin", 1500],
    ]);
    expect(entries[0].mtime?.getTime()).toBe(0o14712345670 * 1000);
  });

  it("extracts .tar, .tar.gz and plain .gz through one entry point", async () => {
    expect((await extractArchive("a.tar", archive())).length).toBe(3);
    const tgz = gzipSync(archive());
    expect((await extractArchive("a.tar.gz", tgz)).map((e) => e.path)).toContain("dir/a.txt");
    const single = await extractArchive("notes.txt.gz", gzipSync(enc("hi")));
    expect(single.map((e) => [e.path, dec(e.data)])).toEqual([["notes.txt", "hi"]]);
    await expect(extractArchive("x.rar", enc("Rar!...."))).rejects.toThrow(/Unsupported archive/);
  });

  it("applies the size limit", () => {
    expect(() => untar(archive(), 1000)).toThrow(/over the safety limit/);
  });
});
