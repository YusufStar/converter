// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { convertData, formatFromName, jsonErrorOffset, jsonToXml, parseData, parseJson, stringifyData, xmlName, xmlToJson } from "./structured";

const sample = { name: "Ayşe", age: 31, tags: ["a", "b"], address: { city: "İstanbul", zip: "34000" }, active: true };

describe("JSON", () => {
  it("points at the line and column of a syntax error", () => {
    expect(() => parseJson('{\n  "a": 1,\n  "b": }')).toThrow('Invalid JSON at line 3, column 8: unexpected "}"');
    expect(() => parseJson('{"a": [1, 2')).toThrow("Invalid JSON at line 1, column 12: unexpected end of input");
    expect(() => parseJson("[1,]")).toThrow("line 1, column 4");
  });

  it("finds no error in valid JSON", () => {
    for (const ok of ['{"a":[1,-2.5e3,true,false,null,"x\\u00e7\\n"]}', "[]", ' "s" ', "0"]) {
      expect(jsonErrorOffset(ok)).toBe(-1);
      expect(() => JSON.parse(ok)).not.toThrow();
    }
  });

  it("formats with indent, tab, minify and sorted keys", async () => {
    const v = { b: 1, a: { d: 2, c: 3 } };
    expect(await stringifyData(v, "json", { indent: 0, sortKeys: false })).toBe('{"b":1,"a":{"d":2,"c":3}}');
    expect(await stringifyData(v, "json", { indent: 0, sortKeys: true })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(await stringifyData([1], "json", { indent: "tab", sortKeys: false })).toBe("[\n\t1\n]\n");
    expect(await stringifyData([1], "json", { indent: 4, sortKeys: false })).toBe("[\n    1\n]\n");
  });
});

describe("YAML", () => {
  it("round-trips JSON values", async () => {
    const yaml = await stringifyData(sample, "yaml", { indent: 2, sortKeys: false });
    expect(yaml).toContain("city: İstanbul");
    expect(yaml).toContain('zip: "34000"');
    expect(await parseData(yaml, "yaml")).toEqual(sample);
  });

  it("reads multi-document streams as an array and reports errors", async () => {
    expect(await parseData("a: 1\n---\nb: 2\n", "yaml")).toEqual([{ a: 1 }, { b: 2 }]);
    await expect(parseData("a: [1, 2\nb: 3", "yaml")).rejects.toThrow(/Invalid YAML: .*line 2, column 1/);
  });
});

describe("TOML", () => {
  it("round-trips objects", async () => {
    const toml = await stringifyData(sample, "toml", { indent: 2, sortKeys: false });
    expect(toml).toContain('name = "Ayşe"');
    expect(toml).toContain("[address]");
    expect(await parseData(toml, "toml")).toEqual(sample);
  });

  it("drops nulls and wraps a top-level array under items", async () => {
    const toml = await stringifyData([{ a: 1, b: null }, null], "toml", { indent: 2, sortKeys: false });
    expect(await parseData(toml, "toml")).toEqual({ items: [{ a: 1 }] });
  });

  it("reports the error position", async () => {
    await expect(parseData("a = \n", "toml")).rejects.toThrow(/Invalid TOML/);
  });
});

describe("XML", () => {
  it("maps attributes, text, repeated elements and types", () => {
    const xml = `<?xml version="1.0"?>
      <library city="Ankara">
        <book id="1"><title>Kürk Mantolu Madonna</title><year>1943</year></book>
        <book id="2"><title>Tutunamayanlar</title><year>1972</year><isbn>0123</isbn></book>
        <note lang="tr">Merhaba &amp; hoş geldin</note>
        <empty/>
        <flag>true</flag>
      </library>`;
    expect(xmlToJson(xml)).toEqual({
      library: {
        "@city": "Ankara",
        book: [
          { "@id": 1, title: "Kürk Mantolu Madonna", year: 1943 },
          { "@id": 2, title: "Tutunamayanlar", year: 1972, isbn: "0123" },
        ],
        note: { "@lang": "tr", "#text": "Merhaba & hoş geldin" },
        empty: "",
        flag: true,
      },
    });
  });

  it("round-trips JSON → XML → JSON", () => {
    const value = { catalog: { "@version": 2, item: [{ name: "a<b>", price: 1.5 }, { name: "ç", price: 2 }], note: { "@x": "y", "#text": "hi" } } };
    const xml = jsonToXml(value);
    expect(xml).toContain('<catalog version="2">');
    expect(xml).toContain("<name>a&lt;b&gt;</name>");
    expect(xmlToJson(xml)).toEqual(value);
  });

  it("wraps arrays and multi-key objects in <root>, sanitizes names, minifies", () => {
    expect(jsonToXml([1, 2], "")).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<root><item>1</item><item>2</item></root>');
    expect(jsonToXml({ a: 1, b: null }, "")).toContain("<root><a>1</a><b/></root>");
    expect(xmlName("1st name")).toBe("_1st_name");
    expect(xmlName("şehir")).toBe("şehir");
  });

  it("reports invalid XML", () => {
    expect(() => xmlToJson("<a><b></a>")).toThrow(/Invalid XML/);
  });
});

describe("convertData", () => {
  it("chains parse and stringify across formats", async () => {
    const json = JSON.stringify(sample);
    const yaml = await convertData(json, "json", "yaml", { indent: 2, sortKeys: false });
    const toml = await convertData(yaml, "yaml", "toml", { indent: 2, sortKeys: false });
    const back = await convertData(toml, "toml", "json", { indent: 2, sortKeys: false });
    expect(JSON.parse(back)).toEqual(sample);
  });

  it("rejects empty input and detects formats from names", async () => {
    await expect(parseData("  ", "json")).rejects.toThrow("The input is empty");
    expect(formatFromName("a.yml")).toBe("yaml");
    expect(formatFromName("Cargo.toml")).toBe("toml");
    expect(formatFromName("x.txt")).toBeNull();
  });
});
