// Barcode formats the zxing-wasm writer can create, with per-format input validation
// (character sets, lengths, GTIN check digits) so problems are explained before encoding.

export type BarcodeKind = "Code128" | "Code39" | "Code93" | "EAN13" | "EAN8" | "UPCA" | "UPCE" | "ITF" | "Codabar" | "DataMatrix" | "PDF417" | "AztecCode";

export interface BarcodeSpec {
  id: BarcodeKind;
  label: string;
  /** 1D symbols can show human-readable text under the bars. */
  linear: boolean;
  sample: string;
}

export const BARCODES: BarcodeSpec[] = [
  { id: "Code128", label: "Code 128", linear: true, sample: "CONVERTER-2026" },
  { id: "Code39", label: "Code 39", linear: true, sample: "ABC-1234" },
  { id: "Code93", label: "Code 93", linear: true, sample: "Code93" },
  { id: "EAN13", label: "EAN-13", linear: true, sample: "5901234123457" },
  { id: "EAN8", label: "EAN-8", linear: true, sample: "96385074" },
  { id: "UPCA", label: "UPC-A", linear: true, sample: "036000291452" },
  { id: "UPCE", label: "UPC-E", linear: true, sample: "01234565" },
  { id: "ITF", label: "ITF", linear: true, sample: "12345678901231" },
  { id: "Codabar", label: "Codabar", linear: true, sample: "A40156B" },
  { id: "DataMatrix", label: "Data Matrix", linear: false, sample: "https://converter.openwild.ai" },
  { id: "PDF417", label: "PDF417", linear: false, sample: "PDF417 sample text" },
  { id: "AztecCode", label: "Aztec", linear: false, sample: "Aztec sample" },
];

/** GS1 mod-10 check digit for the digits before it (EAN-8/13, UPC-A, ITF-14). */
export function gtinCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10;
}

/** UPC-E (number system + 6 digits) → the 11 UPC-A digits its check digit is computed from. */
export function upcEToUpcA(ns: string, d: string): string {
  const [d1, d2, d3, d4, d5, d6] = d;
  if ("012".includes(d6)) return `${ns}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  if (d6 === "3") return `${ns}${d1}${d2}${d3}00000${d4}${d5}`;
  if (d6 === "4") return `${ns}${d1}${d2}${d3}${d4}00000${d5}`;
  return `${ns}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
}

export type BarcodeError = "empty" | "digits" | "length" | "check" | "charset" | "upceSystem" | "codabarChars";

export type BarcodeNote = "checkAdded" | "upper" | "padded" | "startStop";

export type Validation =
  | { ok: true; value: string; note?: BarcodeNote; digit?: number }
  | { ok: false; error: BarcodeError; lengths?: string; expected?: number };

const CODE39 = /^[0-9A-Z \-.$/+%]*$/;
const CODABAR_BODY = /^[0-9\-$:/.+]*$/;

function gtin(value: string, lengths: [number, number]): Validation {
  if (!/^\d+$/.test(value)) return { ok: false, error: "digits" };
  const [short, full] = lengths;
  if (value.length === short) {
    const digit = gtinCheckDigit(value);
    return { ok: true, value: value + digit, note: "checkAdded", digit };
  }
  if (value.length !== full) return { ok: false, error: "length", lengths: `${short}/${full}` };
  const expected = gtinCheckDigit(value.slice(0, -1));
  return Number(value.at(-1)) === expected ? { ok: true, value } : { ok: false, error: "check", expected };
}

export function validateBarcode(kind: BarcodeKind, input: string): Validation {
  const raw = kind === "Code128" || kind === "Code93" || kind === "DataMatrix" || kind === "PDF417" || kind === "AztecCode" ? input : input.trim();
  if (!raw) return { ok: false, error: "empty" };
  switch (kind) {
    case "EAN13":
      return gtin(raw, [12, 13]);
    case "EAN8":
      return gtin(raw, [7, 8]);
    case "UPCA":
      return gtin(raw, [11, 12]);
    case "UPCE": {
      if (!/^\d+$/.test(raw)) return { ok: false, error: "digits" };
      // 6 digits → number system 0; 7 → system + 6; 8 → system + 6 + check.
      const v = raw.length === 6 ? `0${raw}` : raw;
      if (v.length !== 7 && v.length !== 8) return { ok: false, error: "length", lengths: "6/7/8" };
      if (v[0] !== "0" && v[0] !== "1") return { ok: false, error: "upceSystem" };
      const expected = gtinCheckDigit(upcEToUpcA(v[0], v.slice(1, 7)));
      if (v.length === 7) return { ok: true, value: v + expected, note: "checkAdded", digit: expected };
      return Number(v[7]) === expected ? { ok: true, value: v } : { ok: false, error: "check", expected };
    }
    case "ITF":
      if (!/^\d+$/.test(raw)) return { ok: false, error: "digits" };
      return raw.length % 2 ? { ok: true, value: `0${raw}`, note: "padded" } : { ok: true, value: raw };
    case "Code39": {
      const up = raw.toUpperCase();
      if (!CODE39.test(up)) return { ok: false, error: "charset" };
      return up === raw ? { ok: true, value: up } : { ok: true, value: up, note: "upper" };
    }
    case "Codabar": {
      const up = raw.toUpperCase();
      const framed = /^[A-D].*[A-D]$/.test(up) && up.length >= 2;
      const body = framed ? up.slice(1, -1) : up;
      if (!CODABAR_BODY.test(body)) return { ok: false, error: "codabarChars" };
      return framed ? { ok: true, value: up } : { ok: true, value: `A${body}A`, note: "startStop" };
    }
    case "Code128":
      return [...raw].every((c) => c.charCodeAt(0) <= 255) ? { ok: true, value: raw } : { ok: false, error: "charset" };
    case "Code93":
      return /^[\x00-\x7f]*$/.test(raw) ? { ok: true, value: raw } : { ok: false, error: "charset" };
    default:
      return { ok: true, value: raw };
  }
}
