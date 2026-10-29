// Arbitrary-length integer base conversion (2–36) with BigInt.

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const PREFIX: Record<string, number> = { "0x": 16, "0b": 2, "0o": 8 };

export type ParseResult = { ok: true; value: bigint; base: number } | { ok: false; error: "empty" } | { ok: false; error: "digit"; char: string; base: number };

/**
 * Parses an integer written in `base`. Ignores spaces, underscores, commas and
 * apostrophes used as digit separators. A 0x/0b/0o prefix is accepted for its own
 * base, and when `base` is 10 it switches the base (so "0xff" in decimal mode = 255).
 */
export function parseInteger(input: string, base: number): ParseResult {
  let s = input.trim().replace(/[\s_,']/g, "").replace(/^−/, "-").toLowerCase();
  const neg = s.startsWith("-");
  if (neg || s.startsWith("+")) s = s.slice(1);
  const prefixBase = PREFIX[s.slice(0, 2)];
  if (prefixBase && (prefixBase === base || base === 10) && s.length > 2) {
    base = prefixBase;
    s = s.slice(2);
  }
  if (!s) return { ok: false, error: "empty" };
  const valid = DIGITS.slice(0, base);
  for (const ch of s) if (!valid.includes(ch)) return { ok: false, error: "digit", char: ch, base };
  let value: bigint;
  if (base === 10) value = BigInt(s);
  else if (base === 16 || base === 8 || base === 2) value = BigInt(`0${base === 16 ? "x" : base === 8 ? "o" : "b"}${s}`);
  else {
    // ponytail: digit-by-digit O(n²); instant for thousands of digits, chunk if someone pastes megabytes.
    const b = BigInt(base);
    value = 0n;
    for (const ch of s) value = value * b + BigInt(DIGITS.indexOf(ch));
  }
  return { ok: true, value: neg ? -value : value, base };
}

/** Group size that reads naturally per base: binary nibbles, octal triples, decimal thousands, hex words. */
export const groupSize = (base: number) => (base === 8 || base === 10 ? 3 : 4);

/** Inserts `sep` every `size` digits from the right; keeps a leading minus sign. */
export function groupDigits(s: string, size: number, sep = " "): string {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const head = body.length % size || size;
  const parts = [body.slice(0, head)];
  for (let i = head; i < body.length; i += size) parts.push(body.slice(i, i + size));
  return (neg ? "-" : "") + parts.join(sep);
}

export function toBase(value: bigint, base: number, upper = false): string {
  const s = value.toString(base);
  return upper ? s.toUpperCase() : s;
}

/** Two's complement bit pattern of a negative value in `bits` bits, or null when it doesn't fit. */
export function twosComplement(value: bigint, bits: number): bigint | null {
  const b = BigInt(bits);
  if (value < -(1n << (b - 1n)) || value >= 1n << (b - 1n)) return null;
  return value < 0n ? (1n << b) + value : value;
}

/** Number of bits needed for |value| (0 → 1). */
export function bitLength(value: bigint): number {
  return (value < 0n ? -value : value).toString(2).length;
}
