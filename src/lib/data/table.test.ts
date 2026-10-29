// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { columnLetter, convertTable, readTables, recordsToRows, sqlLiteral, type TableOptions } from "./table";

const enc = (s: string) => new TextEncoder().encode(s);
const CSV = "name,age,city,zip\nAyşe,31,İstanbul,03400\nJohn,45,\"New York, NY\",10001\n";

const opts = (p: Partial<TableOptions>): TableOptions => ({
  to: "json",
  sheets: "combined",
  header: true,
  delimiter: ",",
  quoteAll: false,
  bom: false,
  pretty: true,
  table: "",
  isoDates: true,
  ...p,
});

async function one(name: string, bytes: Uint8Array, p: Partial<TableOptions>) {
  const { outputs } = await convertTable(name, bytes, opts(p));
  expect(outputs).toHaveLength(1);
  return outputs[0];
}

function workbook(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("CSV input", () => {
  it("→ JSON: header keys, safe numbers, leading zeros kept as text", async () => {
    const out = await one("people.csv", enc(CSV), { to: "json" });
    expect(out.name).toBe("people.json");
    expect(JSON.parse(await out.blob.text())).toEqual([
      { name: "Ayşe", age: 31, city: "İstanbul", zip: "03400" },
      { name: "John", age: 45, city: "New York, NY", zip: 10001 },
    ]);
  });

  it("→ JSON without header gives arrays", async () => {
    const out = await one("p.csv", enc("a,b\n1,2\n"), { to: "json", header: false, pretty: false });
    expect(await out.blob.text()).toBe('[["a","b"],[1,2]]');
  });

  it("→ CSV with ; delimiter, quote-all and a BOM for Excel", async () => {
    const out = await one("p.csv", enc(CSV), { to: "csv", delimiter: ";", bom: true });
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Ayşe;31;İstanbul;03400\r\n");
    expect(text).toContain("John;45;New York, NY;10001");
    const all = await one("p.csv", enc(CSV), { to: "csv", quoteAll: true });
    expect(await all.blob.text()).toContain('"Ayşe","31","İstanbul","03400"');
  });

  it("→ TSV pads ragged rows", async () => {
    const out = await one("r.csv", enc("a,b,c\n1\n"), { to: "tsv" });
    expect(await out.blob.text()).toBe("a\tb\tc\r\n1\t\t\r\n");
  });

  it("→ XLSX keeps Turkish text, numbers and leading-zero text", async () => {
    const out = await one("people.csv", enc(CSV), { to: "xlsx" });
    expect(out.name).toBe("people.xlsx");
    const wb = XLSX.read(new Uint8Array(await out.blob.arrayBuffer()), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(wb.SheetNames).toEqual(["people"]);
    expect(ws.A2.v).toBe("Ayşe");
    expect(ws.B2).toMatchObject({ t: "n", v: 31 });
    expect(ws.D2).toMatchObject({ t: "s", v: "03400" });
    expect(ws.C3.v).toBe("New York, NY");
  });

  it("decodes Windows-1254 CSV exported by Turkish Excel", async () => {
    const bytes = new Uint8Array([0x61, 0x64, 0x3b, 0xfe, 0x65, 0x68, 0x69, 0x72, 0x0a, 0x41, 0x79, 0xfe, 0x65, 0x3b, 0xdd, 0x7a, 0x6d, 0x69, 0x72]);
    const [sheet] = await readTables("t.csv", bytes);
    expect(sheet.rows).toEqual([
      ["ad", "şehir"],
      ["Ayşe", "İzmir"],
    ]);
  });
});

describe("JSON input", () => {
  it("flattens nested objects to dot keys and keeps arrays as JSON text", () => {
    expect(recordsToRows([{ id: 1, user: { name: "A", geo: { lat: 1 } }, tags: ["x", "y"] }, { id: 2, extra: true }])).toEqual([
      ["id", "user.name", "user.geo.lat", "tags", "extra"],
      [1, "A", 1, '["x","y"]', null],
      [2, null, null, null, true],
    ]);
  });

  it("reads arrays of arrays, a single object and JSON Lines", async () => {
    expect((await readTables("a.json", enc("[[1,2],[3,4]]")))[0].rows).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect((await readTables("o.json", enc('{"a":1,"b":"x"}')))[0].rows).toEqual([
      ["a", "b"],
      [1, "x"],
    ]);
    expect((await readTables("l.jsonl", enc('{"a":1}\n{"a":2}\n')))[0].rows).toEqual([["a"], [1], [2]]);
  });

  it("reports bad JSON with a position", async () => {
    await expect(readTables("bad.json", enc('[{"a":1},]'))).rejects.toThrow("Invalid JSON at line 1, column 10");
  });

  it("object of arrays → sheets: keyed JSON, one workbook, or one file per sheet", async () => {
    const src = enc(JSON.stringify({ Users: [{ n: "a" }], Orders: [{ id: 1 }, { id: 2 }] }));
    const keyed = await one("db.json", src, { to: "json", pretty: false });
    expect(JSON.parse(await keyed.blob.text())).toEqual({ Users: [{ n: "a" }], Orders: [{ id: 1 }, { id: 2 }] });

    const book = await one("db.json", src, { to: "xlsx" });
    expect(XLSX.read(new Uint8Array(await book.blob.arrayBuffer()), { type: "array" }).SheetNames).toEqual(["Users", "Orders"]);

    const each = await convertTable("db.json", src, opts({ to: "csv", sheets: "combined" }));
    expect(each.outputs.map((o) => o.name)).toEqual(["db - Users.csv", "db - Orders.csv"]);

    const first = await convertTable("db.json", src, opts({ to: "json", sheets: "first" }));
    expect(JSON.parse(await first.outputs[0].blob.text())).toEqual([{ n: "a" }]);
  });
});

describe("spreadsheet input", () => {
  const book = () =>
    workbook({
      Sales: [
        ["Ürün", "Tarih", "Adet", "Aktif"],
        ["Çay", new Date(2024, 0, 15), 3, true],
        ["Kahve", new Date(2024, 1, 2, 13, 30), 1.5, false],
      ],
      Empty: [],
      Notes: [["x"], ["y"]],
    });

  it("reads every non-empty sheet; dates become ISO", async () => {
    const out = await one("shop.xlsx", book(), { to: "json", pretty: false });
    expect(JSON.parse(await out.blob.text())).toEqual({
      Sales: [
        { Ürün: "Çay", Tarih: "2024-01-15", Adet: 3, Aktif: true },
        { Ürün: "Kahve", Tarih: "2024-02-02T13:30:00", Adet: 1.5, Aktif: false },
      ],
      Notes: [{ x: "y" }],
    });
  });

  it("keeps the displayed date text when ISO dates are off", async () => {
    const out = await one("shop.xlsx", book(), { to: "csv", sheets: "first", isoDates: false });
    expect(await out.blob.text()).toContain("Çay,1/15/24,3,true");
  });

  it("XLSX → XLSX/ODS keeps real dates", async () => {
    for (const to of ["xlsx", "ods"] as const) {
      const out = await one("shop.xlsx", book(), { to, sheets: "first" });
      const wb = XLSX.read(new Uint8Array(await out.blob.arrayBuffer()), { type: "array", cellDates: true });
      const cell = wb.Sheets.Sales.B2;
      expect(cell.t).toBe("d");
      expect((cell.v as Date).toISOString().slice(0, 10)).toBe("2024-01-15");
    }
  });
});

describe("other outputs", () => {
  it("SQL escapes quotes and types values", async () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(true)).toBe("TRUE");
    expect(sqlLiteral(2.5)).toBe("2.5");
    const out = await one("people.csv", enc('name,"we""ird"\nO\'Neil,1\n'), { to: "sql", table: "" });
    expect(await out.blob.text()).toBe(`INSERT INTO "people" ("name", "we""ird") VALUES ('O''Neil', 1);\n`);
    const named = await one("people.csv", enc("a\n1\n"), { to: "sql", table: "t" });
    expect(await named.blob.text()).toBe('INSERT INTO "t" ("a") VALUES (1);\n');
  });

  it("Markdown escapes pipes and line breaks; no header → column letters", async () => {
    const out = await one("m.csv", enc('a,b\n"x|y","1\n2"\n'), { to: "md" });
    expect(await out.blob.text()).toBe("| a | b |\n| --- | --- |\n| x\\|y | 1<br>2 |\n");
    const bare = await one("m.csv", enc("1,2\n"), { to: "md", header: false });
    expect(await bare.blob.text()).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(columnLetter(0) + columnLetter(25) + columnLetter(26) + columnLetter(701)).toBe("AZAAZZ");
  });

  it("HTML escapes markup and declares UTF-8", async () => {
    const out = await one("h.csv", enc("tag\n<b>&</b>\n"), { to: "html" });
    const html = await out.blob.text();
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<th>tag</th>");
    expect(html).toContain("<td>&lt;b&gt;&amp;&lt;/b&gt;</td>");
  });

  it("XML out → XML in round-trips records", async () => {
    const xml = await one("people.csv", enc(CSV), { to: "xml" });
    const text = await xml.blob.text();
    expect(text).toContain("<name>Ayşe</name>");
    const back = await one("people.xml", new Uint8Array(await xml.blob.arrayBuffer()), { to: "json", pretty: false });
    expect(JSON.parse(await back.blob.text())).toEqual([
      { name: "Ayşe", age: 31, city: "İstanbul", zip: "03400" },
      { name: "John", age: 45, city: "New York, NY", zip: 10001 },
    ]);
  });

  it("YAML output", async () => {
    const out = await one("p.csv", enc("a,b\n1,ş\n"), { to: "yaml" });
    expect(await out.blob.text()).toBe("- a: 1\n  b: ş\n");
  });
});

describe("HTML and XML input", () => {
  it("reads every table with colspan and captions", async () => {
    const html = `<html><body>
      <table><caption>Prices</caption><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>12.50</td></tr></table>
      <table><tr><td colspan="2">wide</td><td>z</td></tr></table></body></html>`;
    const sheets = await readTables("page.html", enc(html));
    expect(sheets).toEqual([
      { name: "Prices", rows: [["Item", "Price"], ["Tea", 12.5]] },
      { name: "page 2", rows: [["wide", null, "z"]] },
    ]);
  });

  it("finds the repeating records under wrapper elements", async () => {
    const xml = `<data><records><record id="7"><name>Ali</name><tags><t>a</t></tags></record><record id="8"><name>Can</name></record></records></data>`;
    const [sheet] = await readTables("r.xml", enc(xml));
    expect(sheet.rows).toEqual([
      ["@id", "name", "tags.t"],
      [7, "Ali", "a"],
      [8, "Can", null],
    ]);
  });

  it("sniffs content when the extension is unknown", async () => {
    expect((await readTables("x.dat", enc('[{"a":1}]')))[0].rows).toEqual([["a"], [1]]);
    expect((await readTables("x.dat", enc("a;b\n1;2")))[0].rows).toEqual([
      ["a", "b"],
      [1, 2],
    ]);
  });
});
