// Unique ID generators: UUID v4/v7 (RFC 9562), ULID and NanoID. All randomness comes from
// crypto.getRandomValues; v7 and ULID stay strictly increasing within one millisecond.

export type IdKind = "v4" | "v7" | "ulid" | "nanoid";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function uuidString(b: Uint8Array): string {
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const uuidv4 = (): string => crypto.randomUUID();

const v7 = { ms: -1, seq: 0 };

/**
 * UUID v7: 48-bit Unix ms + version + 12-bit counter (rand_a, RFC 9562 method 1) + variant +
 * 62 random bits. The counter starts at a random value below 2^11 each millisecond and steps
 * up for every ID in that millisecond, so bulk output sorts in creation order; on overflow (or a
 * clock that went backwards) the timestamp is moved forward by one.
 */
export function uuidv7(now = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let ms = Math.max(now, v7.ms);
  if (ms === v7.ms && v7.seq < 0xfff) v7.seq++;
  else {
    if (ms === v7.ms) ms++;
    v7.seq = ((b[6] & 0x07) << 8) | b[7];
  }
  v7.ms = ms;
  for (let i = 5, t = ms; i >= 0; i--, t = Math.floor(t / 256)) b[i] = t % 256;
  b[6] = 0x70 | (v7.seq >> 8);
  b[7] = v7.seq & 0xff;
  b[8] = 0x80 | (b[8] & 0x3f);
  return uuidString(b);
}

/** Unix ms stored in a v7 UUID (or null for other versions). */
export function uuidv7Time(id: string): number | null {
  const h = id.replace(/[{}-]/g, "");
  if (!/^[0-9a-f]{32}$/i.test(h) || h[12] !== "7") return null;
  return parseInt(h.slice(0, 12), 16);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulidState = { ms: -1, rand: [] as number[] };

/** ULID: 10 Crockford base32 chars of ms time + 16 of randomness; monotonic within one ms. */
export function ulid(now = Date.now()): string {
  let ms = Math.max(now, ulidState.ms);
  let rand = ulidState.rand;
  let bumped = false;
  if (ms === ulidState.ms) {
    rand = [...rand];
    let i = rand.length - 1;
    while (i >= 0 && rand[i] === 31) rand[i--] = 0;
    if (i >= 0) {
      rand[i]++;
      bumped = true;
    } else ms++;
  }
  if (!bumped) rand = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x & 31);
  ulidState.ms = ms;
  ulidState.rand = rand;
  let time = "";
  for (let i = 0, t = ms; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  return time + rand.map((d) => CROCKFORD[d]).join("");
}

export function ulidTime(id: string): number | null {
  const s = id.toUpperCase();
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(s)) return null;
  return [...s.slice(0, 10)].reduce((t, c) => t * 32 + CROCKFORD.indexOf(c), 0);
}

export const NANOID_ALPHABETS = {
  urlSafe: "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict",
  alphanumeric: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  lowercase: "0123456789abcdefghijklmnopqrstuvwxyz",
  hex: "0123456789abcdef",
  numbers: "0123456789",
} as const;

/** NanoID with the same unbiased mask-and-reject sampling as the reference library. */
export function nanoid(size = 21, alphabet: string = NANOID_ALPHABETS.urlSafe): string {
  const chars = [...new Set(alphabet)];
  if (chars.length < 2) throw new Error("Alphabet needs at least 2 different characters");
  if (chars.length > 256) throw new Error("Alphabet can have at most 256 characters");
  const mask = (2 << (31 - Math.clz32((chars.length - 1) | 1))) - 1;
  const step = Math.min(65_536, Math.ceil((1.6 * mask * size) / chars.length));
  let id = "";
  while (id.length < size) {
    for (const byte of crypto.getRandomValues(new Uint8Array(step))) {
      const c = chars[byte & mask];
      if (c !== undefined && (id += c).length === size) break;
    }
  }
  return id;
}

export interface UuidFormat {
  upper?: boolean;
  hyphens?: boolean;
  braces?: boolean;
}

export function formatUuid(id: string, { upper = false, hyphens = true, braces = false }: UuidFormat = {}): string {
  let s = hyphens ? id : id.replace(/-/g, "");
  if (upper) s = s.toUpperCase();
  return braces ? `{${s}}` : s;
}

export interface GenerateOptions extends UuidFormat {
  size?: number;
  alphabet?: string;
}

export const MAX_COUNT = 1000;

export function generateIds(kind: IdKind, count: number, opts: GenerateOptions = {}): string[] {
  const n = Math.max(1, Math.min(MAX_COUNT, Math.floor(count) || 1));
  return Array.from({ length: n }, () => {
    if (kind === "ulid") return ulid();
    if (kind === "nanoid") return nanoid(opts.size, opts.alphabet);
    return formatUuid(kind === "v7" ? uuidv7() : uuidv4(), opts);
  });
}
