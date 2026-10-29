// AcroForm filling with pdf-lib: read every field, write new values, redraw
// their appearances (DejaVu Sans when the text needs more than Latin-1) and
// optionally flatten. No DOM here, so it runs in Node tests.
import type { PDFDocument, PDFField, PDFFont, PDFRef } from "pdf-lib";
import { loadPdf, prune } from "../pdf/edit";
import { loadUnicodeFont, type FontLoader } from "../pdf/stamp";

type Bytes = Uint8Array | ArrayBuffer;

interface Base {
  /** Fully qualified field name (the key for values). */
  name: string;
  /** What to show a person: the field's tooltip (/TU) or the last part of its name. */
  label: string;
  /** 1-based page of the field's first widget (0 = not on a page). */
  page: number;
  readOnly: boolean;
}

export type FormField =
  | (Base & { kind: "text"; value: string; multiline: boolean; maxLength?: number })
  | (Base & { kind: "checkbox"; value: boolean })
  | (Base & { kind: "radio"; value: string; options: string[] })
  | (Base & { kind: "dropdown"; value: string[]; options: string[]; multi: boolean })
  | (Base & { kind: "list"; value: string[]; options: string[]; multi: boolean })
  | (Base & { kind: "signature"; signed: boolean });

export type FieldValue = string | boolean | string[];

const lib = () => import("pdf-lib");

/** Page index + top-to-bottom, left-to-right position of a field's first widget. */
function position(doc: PDFDocument, field: PDFField, pages: Map<PDFRef, number>) {
  const widget = field.acroField.getWidgets()[0];
  if (!widget) return { page: 0, y: 0, x: 0 };
  let page = widget.P() ? pages.get(widget.P() as PDFRef) : undefined;
  if (page === undefined) {
    const ref = doc.context.getObjectRef(widget.dict);
    const found = ref ? doc.findPageForAnnotationRef(ref) : undefined;
    page = found ? pages.get(found.ref) : undefined;
  }
  const r = widget.getRectangle();
  return { page: page === undefined ? 0 : page + 1, y: r.y + r.height, x: r.x };
}

async function describe(field: PDFField, page: number): Promise<FormField | null> {
  const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature, PDFName, PDFString, PDFHexString } = await lib();
  const name = field.getName();
  const tu = field.acroField.dict.lookup(PDFName.of("TU"));
  const tip = tu instanceof PDFString || tu instanceof PDFHexString ? tu.decodeText().trim() : "";
  const base = { name, label: tip || name.replace(/\[\d+\]/g, "").split(".").pop() || name, page, readOnly: field.isReadOnly() };
  if (field instanceof PDFTextField) {
    let value = "";
    try {
      value = field.getText() ?? "";
    } catch {
      // Rich text pdf-lib can't read: show it as read-only and leave it alone.
      return { ...base, kind: "text", value: "", multiline: false, readOnly: true };
    }
    return { ...base, kind: "text", value, multiline: field.isMultiline(), maxLength: field.getMaxLength() };
  }
  if (field instanceof PDFCheckBox) return { ...base, kind: "checkbox", value: field.isChecked() };
  if (field instanceof PDFRadioGroup) return { ...base, kind: "radio", value: field.getSelected() ?? "", options: field.getOptions() };
  if (field instanceof PDFDropdown)
    return { ...base, kind: "dropdown", value: field.getSelected(), options: field.getOptions(), multi: field.isMultiselect() };
  if (field instanceof PDFOptionList)
    return { ...base, kind: "list", value: field.getSelected(), options: field.getOptions(), multi: field.isMultiselect() };
  if (field instanceof PDFSignature) return { ...base, kind: "signature", readOnly: true, signed: field.acroField.dict.has(PDFName.of("V")) };
  return null; // push buttons: nothing to fill
}

/** Every fillable field (plus signature fields) in reading order. Empty for PDFs without a form. */
export async function readFormFields(bytes: Bytes): Promise<FormField[]> {
  const doc = await loadPdf(bytes);
  if (!doc.catalog.getAcroForm()) return [];
  const pages = new Map(doc.getPages().map((p, i) => [p.ref, i]));
  const rows: { f: FormField; y: number; x: number; page: number }[] = [];
  for (const field of doc.getForm().getFields()) {
    const pos = position(doc, field, pages);
    const f = await describe(field, pos.page);
    if (f) rows.push({ f, ...pos });
  }
  // Pages in order (fields on no page last), then top to bottom, left to right.
  rows.sort((a, b) => (a.page || 1e9) - (b.page || 1e9) || b.y - a.y || a.x - b.x);
  return rows.map((r) => r.f);
}

const LATIN1 = /^[\x20-\x7e\xa0-\xff\r\n\t]*$/;

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface FillOptions {
  flatten: boolean;
}

/**
 * Writes `values` (by field name; missing names keep their value) and saves.
 * Only changed fields get new appearances, so untouched ones look exactly as before.
 */
export async function fillForm(bytes: Bytes, values: Record<string, FieldValue>, o: FillOptions, loadFont: FontLoader = loadUnicodeFont): Promise<Uint8Array> {
  const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature, StandardFonts } = await lib();
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  const shown: string[] = [];
  for (const field of form.getFields()) {
    const v = values[field.getName()];
    const editable = v !== undefined && !field.isReadOnly();
    if (field instanceof PDFTextField) {
      let text = "";
      try {
        text = field.getText() ?? "";
      } catch {
        continue; // rich text, left untouched
      }
      if (editable && typeof v === "string" && v !== text) {
        const max = field.getMaxLength();
        text = max === undefined ? v : v.slice(0, max);
        field.setText(text || undefined);
      }
      shown.push(text);
    } else if (field instanceof PDFCheckBox) {
      if (editable && typeof v === "boolean" && v !== field.isChecked()) {
        if (v) field.check();
        else field.uncheck();
      }
    } else if (field instanceof PDFRadioGroup) {
      if (editable && typeof v === "string" && v !== (field.getSelected() ?? "")) {
        if (v) field.select(v);
        else field.clear();
      }
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (editable && Array.isArray(v) && !sameList(v, field.getSelected())) {
        if (v.length) field.select(v);
        else field.clear();
      }
      shown.push(...field.getOptions(), ...field.getSelected());
    }
  }

  // Helvetica only speaks WinAnsi; Turkish, Cyrillic, Greek… need an embedded font.
  let font: PDFFont;
  if (shown.every((t) => LATIN1.test(t))) font = await doc.embedFont(StandardFonts.Helvetica);
  else {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    doc.registerFontkit(fontkit);
    // ponytail: subset + fields keep their /DA font, so later edits in another app fall back to its own font.
    font = await doc.embedFont(await loadFont(), { subset: true });
  }
  form.updateFieldAppearances(font);

  if (o.flatten) {
    // Unsigned signature fields have nothing to draw and pdf-lib's flatten/removeField
    // choke on widgets without an appearance, so unhook them by hand.
    for (const field of form.getFields()) {
      if (!(field instanceof PDFSignature) || field.acroField.getWidgets().every((w) => w.getAppearances())) continue;
      const refs = [field.ref, ...field.acroField.getWidgets().map((w) => doc.context.getObjectRef(w.dict))];
      for (const page of doc.getPages()) for (const ref of refs) if (ref) page.node.removeAnnot(ref);
      form.acroForm.removeField(field.acroField);
    }
    form.flatten({ updateFieldAppearances: false });
  }
  await doc.flush();
  await prune(doc);
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}
