import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { downloadAll, downloadOne, fixture, openTool, runAndWait, trackErrors, uploadFiles, test } from "./helpers";

const BOM = [0xef, 0xbb, 0xbf];
/** UTF-8 decode; TextDecoder drops the BOM, which tests assert on the raw bytes. */
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** A two-sheet workbook with Turkish text and a date, built in Node. */
function workbookBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(
      [
        ["Ad", "Yaş", "Kayıt"],
        ["Ayşe", 31, new Date(2024, 0, 15)],
        ["Çağrı", 45, new Date(2023, 11, 1)],
      ],
      { cellDates: true },
    ),
    "Kişiler",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Şehir", "Nüfus"],
      ["İzmir", 4400000],
    ]),
    "Şehirler",
  );
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

async function uploadBuffer(page: Page, name: string, buffer: Buffer) {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
  await expect(page.getByTestId("queue").locator("li")).toHaveCount(1);
}

test("csv → excel: real workbook, numbers, Turkish text, preview", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "csv-to-excel");
  await uploadFiles(page, ["data.csv"]);
  await runAndWait(page);
  await expect(page.getByTestId("preview")).toContainText("İstanbul");
  const out = await downloadOne(page);
  expect(out.name).toBe("data.xlsx");
  const ws = XLSX.read(out.bytes, { type: "array" }).Sheets.data;
  expect(ws.A2.v).toBe("Ayşe");
  expect(ws.B2).toMatchObject({ t: "n", v: 31 });
  expect(ws.C3.v).toBe("New York, NY");
  expect(errors).toEqual([]);
});

test("excel → csv: one file per sheet, ; delimiter, BOM, ISO dates", async ({ page }) => {
  await openTool(page, "excel-to-csv");
  await uploadBuffer(page, "book.xlsx", workbookBuffer());
  await page.getByRole("radio", { name: ";", exact: true }).click();
  await runAndWait(page);
  const { entries } = await downloadAll(page);
  expect(Object.keys(entries).sort()).toEqual(["book - Kişiler.csv", "book - Şehirler.csv"]);
  const people = entries["book - Kişiler.csv"];
  expect([...people.slice(0, 3)]).toEqual(BOM);
  expect(text(people)).toBe("Ad;Yaş;Kayıt\r\nAyşe;31;2024-01-15\r\nÇağrı;45;2023-12-01\r\n");
  expect(text(entries["book - Şehirler.csv"])).toContain("İzmir;4400000");
});

test("excel → json keyed by sheet name", async ({ page }) => {
  await openTool(page, "excel-to-json");
  await uploadBuffer(page, "book.xlsx", workbookBuffer());
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("book.json");
  expect(JSON.parse(text(out.bytes))).toEqual({
    Kişiler: [
      { Ad: "Ayşe", Yaş: 31, Kayıt: "2024-01-15" },
      { Ad: "Çağrı", Yaş: 45, Kayıt: "2023-12-01" },
    ],
    Şehirler: [{ Şehir: "İzmir", Nüfus: 4400000 }],
  });
});

test("json → csv quotes the comma and csv → json restores the records", async ({ page }) => {
  await openTool(page, "json-to-csv");
  await uploadFiles(page, ["data.json"]);
  await runAndWait(page);
  const csv = await downloadOne(page);
  expect(csv.name).toBe("data.csv");
  expect([...csv.bytes.slice(0, 3)]).toEqual(BOM);
  expect(text(csv.bytes)).toBe('name,age,city\r\nAyşe,31,İstanbul\r\nJohn,45,"New York, NY"\r\n');

  await openTool(page, "csv-to-json");
  await uploadFiles(page, ["data.csv"]);
  await runAndWait(page);
  const json = await downloadOne(page);
  expect(json.name).toBe("data.json");
  expect(JSON.parse(text(json.bytes))).toEqual(JSON.parse(await readFile(fixture("data.json"), "utf8")));
});

test("spreadsheet converter: many files to Markdown and SQL", async ({ page }) => {
  await openTool(page, "spreadsheet-converter");
  await uploadFiles(page, ["data.csv", "data.json"]);
  await page.getByRole("radio", { name: "MD", exact: true }).click();
  await runAndWait(page);
  const md = await downloadAll(page);
  expect(Object.keys(md.entries).sort()).toEqual(["data (2).md", "data.md"]);
  expect(text(md.entries["data.md"])).toBe("| name | age | city |\n| --- | --- | --- |\n| Ayşe | 31 | İstanbul |\n| John | 45 | New York, NY |\n");

  await page.getByRole("radio", { name: "SQL", exact: true }).click();
  await page.getByLabel("Table name").fill("people");
  await runAndWait(page);
  const sql = await downloadAll(page);
  expect(text(sql.entries["data.sql"])).toBe(
    `INSERT INTO "people" ("name", "age", "city") VALUES ('Ayşe', 31, 'İstanbul');\nINSERT INTO "people" ("name", "age", "city") VALUES ('John', 45, 'New York, NY');\n`,
  );
});

test("json formatter: live validation with position, minify, download", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "json-formatter");
  const input = page.getByTestId("paste-input");
  await input.fill('{\n  "name": "Ayşe",\n  "age": }');
  await expect(page.getByTestId("paste-error")).toContainText("Invalid JSON at line 3, column 10");

  await input.fill('{"b": [1, 2], "a": {"şehir": "İstanbul"}}');
  await expect(page.getByTestId("paste-valid")).toBeVisible();
  await expect(page.getByTestId("paste-result")).toHaveValue('{\n  "b": [\n    1,\n    2\n  ],\n  "a": {\n    "şehir": "İstanbul"\n  }\n}\n');

  await page.getByRole("radio", { name: "Minify" }).click();
  await page.getByText("Sort keys A → Z").click();
  await expect(page.getByTestId("paste-result")).toHaveValue('{"a":{"şehir":"İstanbul"},"b":[1,2]}');

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-text").click()]);
  expect(dl.suggestedFilename()).toBe("data.min.json");
  expect(await readFile(await dl.path(), "utf8")).toBe('{"a":{"şehir":"İstanbul"},"b":[1,2]}');
  expect(errors).toEqual([]);
});

test("json → yaml paste mode converts live and swaps", async ({ page }) => {
  await openTool(page, "json-to-yaml");
  await page.getByTestId("paste-input").fill(await readFile(fixture("data.json"), "utf8"));
  const result = page.getByTestId("paste-result");
  await expect(result).toHaveValue("- name: Ayşe\n  age: 31\n  city: İstanbul\n- name: John\n  age: 45\n  city: New York, NY\n");
  await page.getByTestId("swap").click();
  await expect(result).toHaveValue(/^\[\n {2}\{\n {4}"name": "Ayşe",/);
});

test("data format files mode: batch with formats detected from extensions", async ({ page }) => {
  await openTool(page, "xml-to-json");
  await page.getByRole("radio", { name: "Files" }).click();
  await uploadFiles(page, ["data-feed.xml", "data-config.toml", "data.json"]);
  await runAndWait(page);
  const { entries } = await downloadAll(page);
  expect(Object.keys(entries).sort()).toEqual(["data-config.json", "data-feed.json", "data.json"]);
  expect(JSON.parse(text(entries["data-feed.json"]))).toEqual({
    feed: {
      "@lang": "tr",
      entry: [
        { "@id": 1, title: "Kahvaltı", price: 12.5 },
        { "@id": 2, title: "Çay & simit", price: 4 },
      ],
    },
  });
  expect(JSON.parse(text(entries["data-config.json"]))).toEqual({
    title: "Şehir rehberi",
    version: 3,
    owner: { name: "Ayşe", city: "İstanbul" },
    places: [{ name: "Galata", visits: 120 }],
  });
});
