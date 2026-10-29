import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { fillForm, readFormFields } from "./form";

const root = new URL("../../../", import.meta.url);
const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`e2e/fixtures/${name}`, root)));
const dejavu = async () => new Uint8Array(await readFile(new URL("node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", root)));

async function pageText(bytes: Uint8Array, n = 1) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(n);
  return (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
}

describe("readFormFields", () => {
  it("lists every field type in reading order with current values", async () => {
    const fields = await readFormFields(await fixture("pdf-extra-form.pdf"));
    expect(fields.map((f) => [f.name, f.kind, f.page])).toEqual([
      ["name", "text", 1],
      ["notes", "text", 1],
      ["agree", "checkbox", 1],
      ["plan", "radio", 1],
      ["country", "dropdown", 1],
      ["languages", "list", 1],
      ["reference", "text", 1],
      ["signature", "signature", 1],
      ["city", "text", 2],
    ]);
    const by = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(by.name).toMatchObject({ value: "Ayse", multiline: false, readOnly: false });
    expect(by.notes).toMatchObject({ multiline: true, label: "Anything else?" }); // its /TU tooltip
    expect(by.city).toMatchObject({ label: "city" });
    expect(by.agree).toMatchObject({ value: false });
    expect(by.plan).toMatchObject({ value: "pro", options: ["basic", "pro", "team"] });
    expect(by.country).toMatchObject({ value: ["Germany"], options: ["Germany", "Japan", "Turkey"] });
    expect(by.languages).toMatchObject({ value: ["English"], multi: true });
    expect(by.reference).toMatchObject({ value: "REF-001", readOnly: true });
    expect(by.signature).toMatchObject({ readOnly: true, signed: false });
  });

  it("returns nothing for a PDF without a form", async () => {
    expect(await readFormFields(await fixture("sample.pdf"))).toEqual([]);
  });
});

describe("fillForm", () => {
  const values = {
    name: "Ayşe Yılmaz",
    notes: "Line one\nİkinci satır: ğüşöç",
    agree: true,
    plan: "team",
    country: ["Turkey"],
    languages: ["English", "Turkish"],
    reference: "hacked",
    city: "İstanbul",
  };

  it("writes every kind of value and draws Turkish text with DejaVu", async () => {
    const out = await fillForm(await fixture("pdf-extra-form.pdf"), values, { flatten: false }, dejavu);
    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    expect(form.getTextField("name").getText()).toBe("Ayşe Yılmaz");
    expect(form.getTextField("notes").getText()).toBe("Line one\nİkinci satır: ğüşöç");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("plan").getSelected()).toBe("team");
    expect(form.getDropdown("country").getSelected()).toEqual(["Turkey"]);
    expect(form.getOptionList("languages").getSelected()).toEqual(["English", "Turkish"]);
    expect(form.getTextField("reference").getText()).toBe("REF-001"); // read-only stays
    expect(form.getTextField("city").getText()).toBe("İstanbul");
    expect(new TextDecoder("latin1").decode(out)).toContain("DejaVuSans");
  });

  it("flattens: fields are gone and the values are page text", async () => {
    const out = await fillForm(await fixture("pdf-extra-form.pdf"), values, { flatten: true }, dejavu);
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getFields()).toHaveLength(0);
    const text = await pageText(out);
    expect(text).toContain("Ayşe Yılmaz");
    expect(text).toContain("İkinci satır: ğüşöç");
    expect(text).toContain("REF-001");
    expect(await pageText(out, 2)).toContain("İstanbul");
  });

  it("keeps Helvetica when everything is Latin-1", async () => {
    const out = await fillForm(await fixture("pdf-extra-form.pdf"), { name: "Jane Doe" }, { flatten: true }, () => {
      throw new Error("font should not load");
    });
    expect(await pageText(out)).toContain("Jane Doe");
  });
});
