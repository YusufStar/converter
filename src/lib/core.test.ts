import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { normalize, relatedTools, searchTools, TOOLS, toolBySlug, toolsAccepting } from "../catalog";
import { zipBlobs } from "./download";
import { formatBytes, matchesAccept, sizeDelta, splitName, uniqueNames, withExt } from "./files";
import { defineDict, format } from "./i18n";
import { mapPool } from "./pool";
import { extensionsOf } from "./handoff";
import { localize, slugFromPath, splitPath } from "./router";

describe("files", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(formatBytes(512 * 1024 * 1024)).toBe("512 MB");
    expect(formatBytes(-1)).toBe("—");
  });
  it("splits names", () => {
    expect(splitName("photo.final.JPG")).toEqual({ base: "photo.final", ext: "jpg" });
    expect(splitName(".gitignore")).toEqual({ base: ".gitignore", ext: "" });
    expect(splitName("README")).toEqual({ base: "README", ext: "" });
    expect(withExt("a.b.png", "webp")).toBe("a.b.webp");
  });
  it("dedupes names like a file manager", () => {
    expect(uniqueNames(["a.png", "a.png", "A.png", "b", "b"])).toEqual(["a.png", "a (2).png", "A (3).png", "b", "b (2)"]);
  });
  it("matches accept lists", () => {
    expect(matchesAccept({ name: "x.HEIC", type: "" }, "image/*,.heic")).toBe(true);
    expect(matchesAccept({ name: "x.png", type: "image/png" }, "image/*")).toBe(true);
    expect(matchesAccept({ name: "x.pdf", type: "application/pdf" }, "image/*,.svg")).toBe(false);
    expect(matchesAccept({ name: "x.pdf", type: "application/pdf" }, undefined)).toBe(true);
  });
  it("computes size delta", () => {
    expect(sizeDelta(100, 58)).toBe(-42);
    expect(sizeDelta(0, 10)).toBe(0);
  });
});

describe("pool", () => {
  it("keeps order and respects the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapPool([30, 10, 20, 5], 2, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });
});

describe("i18n", () => {
  it("interpolates", () => {
    expect(format("{n} files · {size}", { n: 3, size: "1 MB" })).toBe("3 files · 1 MB");
    expect(format("keep {unknown}", {})).toBe("keep {unknown}");
  });
  it("defineDict keeps every language", () => {
    const d = defineDict({ a: "A" }, { a: "Ä" }, { es: { a: "Á" }, de: { a: "Ö" }, fr: { a: "À" }, pt: { a: "Ã" } });
    expect([d.en.a, d.tr.a, d.es.a, d.de.a, d.fr.a, d.pt.a]).toEqual(["A", "Ä", "Á", "Ö", "À", "Ã"]);
  });
});

describe("router", () => {
  it("reads the slug", () => {
    expect(slugFromPath("/")).toBe("");
    expect(slugFromPath("/webp-converter/")).toBe("webp-converter");
    expect(slugFromPath("/tr/webp-converter")).toBe("webp-converter");
    expect(slugFromPath("/tr")).toBe("");
  });
  it("keeps the language in the path prefix", () => {
    expect(splitPath("/tr/merge-pdf")).toEqual({ lang: "tr", rest: "/merge-pdf" });
    expect(splitPath("/merge-pdf")).toEqual({ lang: "en", rest: "/merge-pdf" });
    expect(splitPath("/en/merge-pdf")).toEqual({ lang: "en", rest: "/en/merge-pdf" });
    expect(splitPath("/")).toEqual({ lang: "en", rest: "/" });
    expect(localize("/merge-pdf", "tr")).toBe("/tr/merge-pdf");
    expect(localize("/tr/merge-pdf", "en")).toBe("/merge-pdf");
    expect(localize("/", "tr")).toBe("/tr");
    expect(localize("/tr", "en")).toBe("/");
  });
});

describe("catalog", () => {
  it("has unique slugs and complete copy", () => {
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.slug).toMatch(/^[a-z0-9-]+$/);
      expect(t.name.en && t.name.tr && t.desc.en && t.desc.tr).toBeTruthy();
    }
  });
  it("searches across languages and diacritics", () => {
    expect(normalize("Görsel İŞLEM")).toBe("gorsel islem");
    expect(searchTools("webp").map((t) => t.slug)).toContain("webp-converter");
    expect(searchTools("gorsel donustur").map((t) => t.slug)).toContain("image-converter");
    expect(searchTools("heic jpg").map((t) => t.slug)).toContain("heic-converter");
    expect(toolBySlug.get("images-to-pdf")?.group).toBe("pdf");
  });
  it("preset pages point at a real parent with the same engine", () => {
    for (const t of TOOLS.filter((x) => x.parent)) {
      const parent = toolBySlug.get(t.parent!);
      expect(parent, t.slug).toBeTruthy();
      expect(parent!.parent, `${t.slug}: parent must be a main tool`).toBeUndefined();
      expect(t.engine, t.slug).toBe(parent!.engine);
    }
    expect(relatedTools(toolBySlug.get("png-to-jpg")!).map((t) => t.slug)).toContain("jpg-converter");
    expect(relatedTools(toolBySlug.get("jpg-converter")!).map((t) => t.slug)).toContain("png-to-jpg");
  });
  it("input extensions are bare lowercase and route files to tools", () => {
    for (const t of TOOLS) for (const ext of t.input ?? []) expect(ext, t.slug).toMatch(/^[a-z0-9]+$/);
    expect(extensionsOf([{ name: "a.PDF" }, { name: "b.pdf" }, { name: "noext" }])).toEqual(["pdf"]);
    const forPdf = toolsAccepting(["pdf"]).map((t) => t.slug);
    expect(forPdf).toContain("merge-pdf");
    expect(forPdf).not.toContain("webp-converter");
    expect(forPdf.some((s) => toolBySlug.get(s)!.parent)).toBe(false);
    expect(toolsAccepting(["pdf", "docx"])).toEqual([]);
    expect(toolsAccepting([])).toEqual([]);
  });
});

describe("zip", () => {
  it("zips blobs with unique names", async () => {
    const zip = await zipBlobs([
      { name: "a.txt", blob: new Blob(["hello"], { type: "text/plain" }) },
      { name: "a.txt", blob: new Blob(["world"], { type: "text/plain" }) },
      { name: "p.png", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
    ]);
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(["a (2).txt", "a.txt", "p.png"]);
    expect(new TextDecoder().decode(entries["a (2).txt"])).toBe("world");
    expect([...entries["p.png"]]).toEqual([1, 2, 3]);
  });
});
