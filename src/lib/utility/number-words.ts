// Numbers spelled out in English (US style) and Turkish, up to 10^36 − 1.

export type WordsLang = "en" | "tr";

const EN_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const EN_TENS = " ten twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const EN_SCALE = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion", "sextillion", "septillion", "octillion", "nonillion", "decillion"];

const TR_ONES = "sıfır bir iki üç dört beş altı yedi sekiz dokuz".split(" ");
const TR_TENS = " on yirmi otuz kırk elli altmış yetmiş seksen doksan".split(" ");
const TR_SCALE = ["", "bin", "milyon", "milyar", "trilyon", "katrilyon", "kentilyon", "seksilyon", "septilyon", "oktilyon", "nonilyon", "desilyon"];

export const MAX_DIGITS = EN_SCALE.length * 3;

function enBelow1000(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) out.push(EN_ONES[Math.floor(n / 100)], "hundred");
  const r = n % 100;
  if (r) out.push(r < 20 ? EN_ONES[r] : EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ""));
  return out;
}

function trBelow1000(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  if (h) out.push(...(h > 1 ? [TR_ONES[h]] : []), "yüz");
  if (n % 100 >= 10) out.push(TR_TENS[Math.floor((n % 100) / 10)]);
  if (n % 10) out.push(TR_ONES[n % 10]);
  return out;
}

/** Spells a non-negative integer given as a digit string. */
export function integerWords(digits: string, lang: WordsLang): string {
  const d = digits.replace(/^0+(?=\d)/, "");
  if (d.length > MAX_DIGITS) throw new RangeError("too large");
  if (/^0+$/.test(d)) return lang === "en" ? EN_ONES[0] : TR_ONES[0];
  const groups: number[] = [];
  for (let end = d.length; end > 0; end -= 3) groups.unshift(Number(d.slice(Math.max(0, end - 3), end)));
  const out: string[] = [];
  groups.forEach((g, i) => {
    if (!g) return;
    const scale = groups.length - 1 - i;
    if (lang === "en") out.push(...enBelow1000(g), EN_SCALE[scale]);
    // Turkish says "bin", not "bir bin", for exactly one thousand in its group.
    else out.push(...(scale === 1 && g === 1 ? [] : trBelow1000(g)), TR_SCALE[scale]);
  });
  return out.filter(Boolean).join(" ");
}

/**
 * Normalises "1,234.56", "1.234,56", "-12,5", "1 000" to "-1234.56"-style strings.
 * A single separator followed by exactly three digits is ambiguous: English reads
 * it as thousands for ",", Turkish for ".".
 */
export function normalizeDecimal(input: string, lang: WordsLang): string | null {
  let s = input.trim().replace(/[\s_ ']/g, "").replace(/^−/, "-");
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const sign = s.startsWith("-") ? "-" : "";
  s = s.replace(/^[-+]/, "");
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let dec: "," | "." | null = null;
  if (commas && dots) dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
  else if (commas === 1 || dots === 1) {
    const sep = commas ? "," : ".";
    const grouping = lang === "en" ? "," : ".";
    dec = sep === grouping && /^\d{1,3}[.,]\d{3}$/.test(s) ? null : sep;
  }
  const [int, frac = "", extra] = dec ? s.split(dec) : [s];
  if (extra !== undefined) return null;
  const intDigits = int.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intDigits) || !/^\d*$/.test(frac) || (!intDigits && !frac)) return null;
  return sign + (intDigits || "0") + (frac ? `.${frac}` : "");
}

export interface WordsOptions {
  /** Read as money: dollars/cents or lira/kuruş (rounded to 2 decimals). */
  currency?: boolean;
}

/** "-12.5" → "minus twelve point five" / "eksi on iki virgül beş". */
export function numberToWords(normalized: string, lang: WordsLang, { currency = false }: WordsOptions = {}): string {
  const neg = normalized.startsWith("-");
  let [int, frac = ""] = normalized.replace(/^-/, "").split(".");
  const minus = neg && /[1-9]/.test(int + frac) ? (lang === "en" ? "minus " : "eksi ") : "";

  if (currency) {
    // Round to cents with string maths so 0.005 doesn't fall prey to binary floats.
    let cents = Number((frac + "000").slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
    if (cents === 100) {
      cents = 0;
      int = (BigInt(int) + 1n).toString();
    }
    const whole = integerWords(int, lang);
    const centWords = cents ? integerWords(String(cents), lang) : "";
    if (lang === "tr") return minus + [`${whole} Türk lirası`, cents ? `${centWords} kuruş` : ""].filter(Boolean).join(" ");
    const dollars = `${whole} ${/^0*1$/.test(int) ? "dollar" : "dollars"}`;
    return minus + (cents ? `${dollars} and ${centWords} ${cents === 1 ? "cent" : "cents"}` : dollars);
  }

  const words = integerWords(int, lang);
  if (!frac) return minus + words;
  if (lang === "en") return `${minus}${words} point ${Array.from(frac, (d) => EN_ONES[Number(d)]).join(" ")}`;
  // Turkish reads the fraction as a number, keeping leading zeros: 3,05 → "üç virgül sıfır beş".
  const lead = (frac.match(/^0+/)?.[0] ?? "").length;
  const rest = frac.slice(lead);
  const fracWords = Array.from({ length: lead }, () => TR_ONES[0]);
  if (rest) fracWords.push(integerWords(rest, "tr"));
  return `${minus}${words} virgül ${fracWords.join(" ")}`;
}
