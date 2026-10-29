// JWT decoding and signature verification with WebCrypto. Nothing here talks to a server.

import { base64ToBytes } from "../utility/encoding";

export class JwtError extends Error {
  constructor(public code: "empty" | "parts" | "jwe" | "header" | "payload" | "alg" | "key" | "keyType") {
    super(code);
  }
}

export interface DecodedJwt {
  /** Raw base64url segments. */
  parts: [string, string, string];
  header: Record<string, unknown>;
  /** Parsed JSON payload, or null when the payload is not JSON. */
  payload: Record<string, unknown> | null;
  /** Payload as text (pretty JSON when it parsed). */
  payloadText: string;
  headerText: string;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function b64url(s: string, code: "header" | "payload"): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new JwtError(code);
  try {
    return base64ToBytes(s);
  } catch {
    throw new JwtError(code);
  }
}

/** Strips whitespace and a leading "Bearer ", so a copied Authorization header works too. */
export const cleanToken = (input: string) => input.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");

export function decodeJwt(input: string): DecodedJwt {
  const token = cleanToken(input);
  if (!token) throw new JwtError("empty");
  const parts = token.split(".");
  if (parts.length === 5) throw new JwtError("jwe");
  if (parts.length !== 3) throw new JwtError("parts");
  let header: unknown;
  try {
    header = JSON.parse(utf8.decode(b64url(parts[0], "header")));
  } catch (e) {
    throw e instanceof JwtError ? e : new JwtError("header");
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) throw new JwtError("header");
  let payloadText: string;
  try {
    payloadText = utf8.decode(b64url(parts[1], "payload"));
  } catch (e) {
    throw e instanceof JwtError ? e : new JwtError("payload");
  }
  let payload: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(payloadText);
    if (p && typeof p === "object" && !Array.isArray(p)) {
      payload = p;
      payloadText = JSON.stringify(p, null, 2);
    }
  } catch {
    // Non-JSON payloads (allowed by JWS) are shown as text.
  }
  return { parts: parts as [string, string, string], header: header as Record<string, unknown>, payload, payloadText, headerText: JSON.stringify(header, null, 2) };
}

export type TokenStatus = "valid" | "expired" | "notYet" | "none";

export interface TimeClaims {
  iat?: number;
  nbf?: number;
  exp?: number;
  status: TokenStatus;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** iat/nbf/exp (seconds) and whether the token is currently usable. */
export function timeClaims(payload: Record<string, unknown> | null, nowSec = Date.now() / 1000): TimeClaims {
  const iat = num(payload?.iat);
  const nbf = num(payload?.nbf);
  const exp = num(payload?.exp);
  const status: TokenStatus = exp !== undefined && nowSec >= exp ? "expired" : nbf !== undefined && nowSec < nbf ? "notYet" : exp !== undefined || nbf !== undefined ? "valid" : "none";
  return { iat, nbf, exp, status };
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Largest whole unit for a signed difference in seconds, e.g. -7200 → [-2, "hour"]. */
export function relativeUnit(diffSec: number): [number, Intl.RelativeTimeFormatUnit] {
  const abs = Math.abs(diffSec);
  for (const [unit, size] of UNITS) if (abs >= size || unit === "second") return [Math.trunc(diffSec / size), unit];
  return [0, "second"];
}

// ---------------------------------------------------------------- verification

type AlgSpec = { import: RsaHashedImportParams | EcKeyImportParams | HmacImportParams | Algorithm; verify: Algorithm | RsaPssParams | EcdsaParams };

const sha = (n: number) => `SHA-${n}`;

export function algSpec(alg: string): AlgSpec | null {
  const m = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg);
  if (m) {
    const hash = sha(Number(m[2]));
    if (m[1] === "HS") return { import: { name: "HMAC", hash }, verify: { name: "HMAC" } };
    if (m[1] === "RS") return { import: { name: "RSASSA-PKCS1-v1_5", hash }, verify: { name: "RSASSA-PKCS1-v1_5" } };
    if (m[1] === "PS") return { import: { name: "RSA-PSS", hash }, verify: { name: "RSA-PSS", saltLength: Number(m[2]) / 8 } as RsaPssParams };
    const namedCurve = { 256: "P-256", 384: "P-384", 512: "P-521" }[m[2]]!;
    return { import: { name: "ECDSA", namedCurve }, verify: { name: "ECDSA", hash } as EcdsaParams };
  }
  if (alg === "EdDSA" || alg === "Ed25519") return { import: { name: "Ed25519" }, verify: { name: "Ed25519" } };
  return null;
}

export const isHmac = (alg: string) => /^HS(256|384|512)$/.test(alg);

// Minimal DER walker: enough to pull the SubjectPublicKeyInfo out of an X.509 certificate.
function tlv(b: Uint8Array, at: number): { tag: number; start: number; end: number } {
  const tag = b[at];
  let len = b[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i];
    start += n;
  }
  if (start + len > b.length) throw new JwtError("key");
  return { tag, start, end: start + len };
}

function spkiFromCertificate(der: Uint8Array): Uint8Array {
  const tbs = tlv(der, tlv(der, 0).start);
  let at = tbs.start;
  if (der[at] === 0xa0) at = tlv(der, at).end; // [0] version
  for (let i = 0; i < 5; i++) at = tlv(der, at).end; // serial, signature, issuer, validity, subject
  return der.subarray(at, tlv(der, at).end);
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (; n > 0; n = Math.floor(n / 256)) out.unshift(n % 256);
  return [0x80 | out.length, ...out];
}

/** PKCS#1 RSAPublicKey → SubjectPublicKeyInfo (WebCrypto only imports the latter). */
function spkiFromPkcs1(pkcs1: Uint8Array): Uint8Array {
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const bitString = [0x03, ...derLength(pkcs1.length + 1), 0x00, ...pkcs1];
  const body = [...algId, ...bitString];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

function pemToSpki(pem: string): Uint8Array {
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]+?)-----END \1-----/.exec(pem);
  if (!m) throw new JwtError("key");
  let der: Uint8Array;
  try {
    der = base64ToBytes(m[2]);
  } catch {
    throw new JwtError("key");
  }
  if (m[1] === "PUBLIC KEY") return der;
  if (m[1] === "RSA PUBLIC KEY") return spkiFromPkcs1(der);
  if (m[1] === "CERTIFICATE") return spkiFromCertificate(der);
  throw new JwtError("keyType");
}

async function publicKey(text: string, spec: AlgSpec, kid: unknown): Promise<CryptoKey> {
  const src = text.trim();
  if (src.startsWith("{")) {
    let jwk: JsonWebKey & { keys?: (JsonWebKey & { kid?: string })[] };
    try {
      jwk = JSON.parse(src);
    } catch {
      throw new JwtError("key");
    }
    // A JWKS: take the key with the token's kid, or the only one.
    if (Array.isArray(jwk.keys)) jwk = jwk.keys.find((k) => k.kid === kid) ?? (jwk.keys.length === 1 ? jwk.keys[0] : (undefined as never));
    if (!jwk) throw new JwtError("key");
    const { alg: _alg, use: _use, key_ops: _ops, ...clean } = jwk as JsonWebKey & { use?: string };
    return crypto.subtle.importKey("jwk", clean, spec.import, false, ["verify"]);
  }
  return crypto.subtle.importKey("spki", pemToSpki(src) as BufferSource, spec.import, false, ["verify"]);
}

export interface VerifyKey {
  /** HMAC secret (HS*). */
  secret?: string;
  /** The secret is Base64/Base64url encoded bytes. */
  secretBase64?: boolean;
  /** PEM (public key, RSA public key or certificate) or JWK / JWKS JSON (RS*, PS*, ES*, EdDSA). */
  publicKey?: string;
}

/** True when the signature matches. Throws JwtError for unusable tokens or keys. */
export async function verifyJwt(input: string, key: VerifyKey): Promise<boolean> {
  const { parts, header } = decodeJwt(input);
  const alg = String(header.alg ?? "");
  const spec = algSpec(alg);
  if (!spec) throw new JwtError("alg");
  let cryptoKey: CryptoKey;
  try {
    if (isHmac(alg)) {
      const raw = key.secretBase64 ? base64ToBytes(key.secret ?? "") : new TextEncoder().encode(key.secret ?? "");
      if (!raw.length) throw new JwtError("key");
      cryptoKey = await crypto.subtle.importKey("raw", raw as BufferSource, spec.import, false, ["verify"]);
    } else cryptoKey = await publicKey(key.publicKey ?? "", spec, header.kid);
  } catch (e) {
    throw e instanceof JwtError ? e : new JwtError("key");
  }
  let sig: Uint8Array;
  try {
    sig = base64ToBytes(parts[2]);
  } catch {
    return false;
  }
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  try {
    return await crypto.subtle.verify(spec.verify, cryptoKey, sig as BufferSource, data);
  } catch {
    return false;
  }
}
