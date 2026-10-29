import { describe, expect, it } from "vitest";
import { decodeText, detectDelimiter, parseCsv, writeCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded delimiters and newlines", () => {
    const text = 'name,note\r\n"Smith, John","He said ""hi""\nthen left"\nAyşe,İstanbul\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Smith, John", 'He said "hi"\nthen left'],
      ["Ayşe", "İstanbul"],
    ]);
  });

  it("keeps empty fields and skips blank lines", () => {
    expect(parseCsv("a,,c\n\n,b,\n")).toEqual([
      ["a", "", "c"],
      ["", "b", ""],
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  it("strips a BOM and detects ; tab and | delimiters", () => {
    expect(parseCsv("﻿ad;yaş\nAyşe;31")).toEqual([
      ["ad", "yaş"],
      ["Ayşe", "31"],
    ]);
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a|b|c")).toBe("|");
    expect(detectDelimiter('"x,y";b;c')).toBe(";");
    expect(detectDelimiter("single")).toBe(",");
  });

  it("takes the rest of the input for an unterminated quote", () => {
    expect(parseCsv('a,"b\nc')).toEqual([["a", "b\nc"]]);
  });
});

describe("writeCsv", () => {
  const rows = [
    ["name", "city"],
    ["John", "New York, NY"],
    ['Say "hi"', "line\nbreak"],
  ];

  it("quotes only when needed by default", () => {
    expect(writeCsv(rows)).toBe('name,city\r\nJohn,"New York, NY"\r\n"Say ""hi""","line\nbreak"\r\n');
  });

  it("supports other delimiters, quote-all and a BOM", () => {
    expect(writeCsv([["a,b", "c"]], { delimiter: ";" })).toBe("a,b;c\r\n");
    expect(writeCsv([["a", "b"]], { quoteAll: true })).toBe('"a","b"\r\n');
    expect(writeCsv([["ş"]], { bom: true }).charCodeAt(0)).toBe(0xfeff);
  });

  it("round-trips through parseCsv", () => {
    expect(parseCsv(writeCsv(rows, { delimiter: "|" }), "|")).toEqual(rows);
  });
});

describe("decodeText", () => {
  it("reads UTF-8 (with or without BOM) and falls back to Windows-1254", () => {
    expect(decodeText(new TextEncoder().encode("﻿şğı"))).toBe("şğı");
    // "şğı" in Windows-1254
    expect(decodeText(new Uint8Array([0xfe, 0xf0, 0xfd]))).toBe("şğı");
  });
});
