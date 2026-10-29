import { describe, expect, it } from "vitest";
import { GROUPS } from "../catalog";
import type { ToolMeta } from "../catalog-types";

// Every UI string and catalog entry exists in every language, with the same {placeholders}.

const LANGS = ["en", "tr", "es", "de", "fr", "pt"] as const;

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

type Dict = Record<string, Record<string, string>>;
const isDict = (v: unknown): v is Dict =>
  !!v && typeof v === "object" && typeof (v as Dict).en === "object" && typeof (v as Dict).tr === "object";

const stringModules = import.meta.glob<Record<string, unknown>>(["../ui/strings.ts", "../tools/*/strings.ts"], { eager: true });
const catalogModules = import.meta.glob<Record<string, unknown>>("../tools/*/catalog.ts", { eager: true });

for (const [file, mod] of Object.entries(stringModules)) {
  describe(file.replace("../", "src/"), () => {
    for (const [name, dict] of Object.entries(mod)) {
      if (!isDict(dict)) continue;
      it(`${name} is translated into every language`, () => {
        const keys = Object.keys(dict.en).sort();
        for (const lang of LANGS) {
          const table = dict[lang];
          expect(table, `${name}.${lang} missing`).toBeTruthy();
          expect(Object.keys(table).sort(), `${name}.${lang} keys`).toEqual(keys);
          for (const key of keys) {
            expect(table[key]?.trim(), `${name}.${lang}.${key} empty`).toBeTruthy();
            expect(placeholders(table[key]), `${name}.${lang}.${key} placeholders`).toEqual(placeholders(dict.en[key]));
          }
        }
      });
    }
  });
}

for (const [file, mod] of Object.entries(catalogModules)) {
  describe(file.replace("../", "src/"), () => {
    const tools = Object.values(mod).filter(Array.isArray).flat() as ToolMeta[];
    it("every tool's name and description are translated", () => {
      for (const tool of tools)
        for (const lang of LANGS) {
          expect(tool.name[lang]?.trim(), `${tool.slug} name.${lang}`).toBeTruthy();
          expect(tool.desc[lang]?.trim(), `${tool.slug} desc.${lang}`).toBeTruthy();
        }
    });
  });
}

describe("src/catalog.ts", () => {
  it("group names are translated", () => {
    for (const g of GROUPS) for (const lang of LANGS) expect(g.name[lang]?.trim(), `${g.id}.${lang}`).toBeTruthy();
  });
});
