// Roman numerals, standard subtractive form, 1–3999.

const TABLE: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export const ROMAN_MAX = 3999;

/** 2026 → [[1000,"M"],[1000,"M"],[10,"X"],[10,"X"],[5,"V"],[1,"I"]] */
export function romanParts(n: number): [number, string][] {
  const out: [number, string][] = [];
  for (const [v, s] of TABLE)
    while (n >= v) {
      out.push([v, s]);
      n -= v;
    }
  return out;
}

export function toRoman(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > ROMAN_MAX) return null;
  return romanParts(n)
    .map(([, s]) => s)
    .join("");
}

/** Strict: only canonical numerals ("IIII", "VX", "IC" are rejected). */
export function fromRoman(input: string): number | null {
  const s = input.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(s)) return null;
  const val: Record<string, number> = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = val[s[i]];
    n += v < (val[s[i + 1]] ?? 0) ? -v : v;
  }
  return toRoman(n) === s ? n : null;
}
