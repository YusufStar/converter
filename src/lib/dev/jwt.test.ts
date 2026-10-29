import { constants, createHmac, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JwtError, decodeJwt, relativeUnit, timeClaims, verifyJwt } from "./jwt";

const b64url = (x: string | Buffer) => Buffer.from(x).toString("base64url");

function token(header: object, payload: object | string, signer: (data: string) => Buffer): string {
  const data = `${b64url(JSON.stringify(header))}.${b64url(typeof payload === "string" ? payload : JSON.stringify(payload))}`;
  return `${data}.${b64url(signer(data))}`;
}

const hs = (secret: string | Buffer, bits = 256) => (d: string) => createHmac(`sha${bits}`, secret).update(d).digest();

// Self-signed P-256 certificate (openssl req -x509 -newkey ec) and its private key.
const CERT = `-----BEGIN CERTIFICATE-----
MIIBijCCAS+gAwIBAgIUdyvrt2B1dVuLYUWPL2yiAfQ6VDMwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOY29udmVydGVyLXRlc3QwIBcNMjYxMDI5MTUzNTA1WhgPMjEy
NjEwMDUxNTM1MDVaMBkxFzAVBgNVBAMMDmNvbnZlcnRlci10ZXN0MFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAE+V8SjJ34cr+vx3+zasldDZv8zWUgPa3aPY53zwMW
Z5Cttfr6TtvmU3tpUe+9t79VOTjF/PtwNuJldKdY6YCs36NTMFEwHQYDVR0OBBYE
FO9IWGmBajNDc7art7yq3pa/t0r5MB8GA1UdIwQYMBaAFO9IWGmBajNDc7art7yq
3pa/t0r5MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSQAwRgIhANxqV/L7
D/3NUuNZrhXLdzC4gMTERlSFvNXctCANZlWUAiEA96Thh0Fcz8N0m+B8Bbij2MZQ
Q4Kqv7/VekXK2alyyLE=
-----END CERTIFICATE-----`;
const CERT_KEY = createPrivateKey(`-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgUWhFwysuhJrFVRmm
KAu4jXwX9E4asu7ZhVhPVQ0qHfKhRANCAAT5XxKMnfhyv6/Hf7NqyV0Nm/zNZSA9
rdo9jnfPAxZnkK21+vpO2+ZTe2lR7723v1U5OMX8+3A24mV0p1jpgKzf
-----END PRIVATE KEY-----`);

const es = (key: KeyObject, bits = 256) => (d: string) => sign(`sha${bits}`, Buffer.from(d), { key, dsaEncoding: "ieee-p1363" });

describe("decodeJwt", () => {
  it("decodes header, payload and keeps raw parts; accepts a Bearer prefix and line breaks", () => {
    const t = token({ alg: "HS256", typ: "JWT" }, { sub: "42", name: "Şule Ğür", iat: 1_700_000_000 }, hs("s"));
    const d = decodeJwt(`Bearer ${t.slice(0, 20)}\n${t.slice(20)}`);
    expect(d.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(d.payload).toEqual({ sub: "42", name: "Şule Ğür", iat: 1_700_000_000 });
    expect(d.payloadText).toBe(JSON.stringify(d.payload, null, 2));
    expect(d.parts.join(".")).toBe(t);
  });

  it("shows non-JSON payloads as text and rejects broken tokens with a reason", () => {
    expect(decodeJwt(token({ alg: "none" }, "hello", () => Buffer.alloc(0))).payloadText).toBe("hello");
    const code = (s: string) => {
      try {
        decodeJwt(s);
        return "ok";
      } catch (e) {
        return (e as JwtError).code;
      }
    };
    expect(code("")).toBe("empty");
    expect(code("abc.def")).toBe("parts");
    expect(code("a.b.c.d.e")).toBe("jwe");
    expect(code("!!!.e30.x")).toBe("header");
    expect(code(`${b64url("[1]")}.e30.x`)).toBe("header");
    expect(code(`e30.${b64url(Buffer.from([0xff, 0xfe]))}.x`)).toBe("payload");
  });
});

describe("time claims", () => {
  it("reports expired / not yet valid / valid / none", () => {
    expect(timeClaims({ exp: 100 }, 200).status).toBe("expired");
    expect(timeClaims({ exp: 100 }, 100).status).toBe("expired");
    expect(timeClaims({ nbf: 300, exp: 400 }, 200).status).toBe("notYet");
    expect(timeClaims({ iat: 50, exp: 400 }, 200)).toEqual({ iat: 50, nbf: undefined, exp: 400, status: "valid" });
    expect(timeClaims({ iat: 50 }, 200).status).toBe("none");
    expect(timeClaims({ exp: "soon" }, 200).status).toBe("none");
  });

  it("picks the largest whole unit", () => {
    expect(relativeUnit(-7200)).toEqual([-2, "hour"]);
    expect(relativeUnit(90)).toEqual([1, "minute"]);
    expect(relativeUnit(3 * 86_400 + 5)).toEqual([3, "day"]);
    expect(relativeUnit(-40 * 86_400)).toEqual([-1, "month"]);
    expect(relativeUnit(0)).toEqual([0, "second"]);
  });
});

describe("verifyJwt", () => {
  it("HS256/384/512 with a text or Base64 secret", async () => {
    const t = token({ alg: "HS256" }, { a: 1 }, hs("my secret"));
    expect(await verifyJwt(t, { secret: "my secret" })).toBe(true);
    expect(await verifyJwt(t, { secret: "wrong" })).toBe(false);
    const t512 = token({ alg: "HS512" }, { a: 1 }, hs("k", 512));
    expect(await verifyJwt(t512, { secret: "k" })).toBe(true);
    const bytes = Buffer.from([1, 2, 3, 250, 251]);
    const t384 = token({ alg: "HS384" }, { a: 1 }, hs(bytes, 384));
    expect(await verifyJwt(t384, { secret: bytes.toString("base64"), secretBase64: true })).toBe(true);
    await expect(verifyJwt(t, { secret: "" })).rejects.toMatchObject({ code: "key" });
  });

  it("RS256 and PS256 with SPKI PEM, PKCS#1 PEM and JWK", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rs = token({ alg: "RS256", kid: "k2" }, { a: 1 }, (d) => sign("sha256", Buffer.from(d), privateKey));
    const spki = publicKey.export({ type: "spki", format: "pem" }) as string;
    const pkcs1 = publicKey.export({ type: "pkcs1", format: "pem" }) as string;
    const jwk = publicKey.export({ format: "jwk" });
    expect(await verifyJwt(rs, { publicKey: spki })).toBe(true);
    expect(await verifyJwt(rs, { publicKey: pkcs1 })).toBe(true);
    expect(await verifyJwt(rs, { publicKey: JSON.stringify({ ...jwk, alg: "RS256", use: "sig" }) })).toBe(true);
    // JWKS: the key is picked by kid.
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    expect(await verifyJwt(rs, { publicKey: JSON.stringify({ keys: [{ ...other, kid: "k1" }, { ...jwk, kid: "k2" }] }) })).toBe(true);
    expect(await verifyJwt(rs, { publicKey: JSON.stringify(other) })).toBe(false);

    const ps = token({ alg: "PS256" }, { a: 1 }, (d) => sign("sha256", Buffer.from(d), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }));
    expect(await verifyJwt(ps, { publicKey: spki })).toBe(true);
  });

  it("ES256/ES384 with PEM, JWK or an X.509 certificate", async () => {
    const p256 = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const t = token({ alg: "ES256" }, { a: 1 }, es(p256.privateKey));
    expect(await verifyJwt(t, { publicKey: p256.publicKey.export({ type: "spki", format: "pem" }) as string })).toBe(true);
    expect(await verifyJwt(t, { publicKey: JSON.stringify(p256.publicKey.export({ format: "jwk" })) })).toBe(true);
    // Tampered payload.
    const [h, , s] = t.split(".");
    expect(await verifyJwt(`${h}.${b64url('{"a":2}')}.${s}`, { publicKey: p256.publicKey.export({ type: "spki", format: "pem" }) as string })).toBe(false);

    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" });
    const t384 = token({ alg: "ES384" }, { a: 1 }, es(p384.privateKey, 384));
    expect(await verifyJwt(t384, { publicKey: p384.publicKey.export({ type: "spki", format: "pem" }) as string })).toBe(true);

    const cert = token({ alg: "ES256" }, { a: 1 }, es(CERT_KEY));
    expect(await verifyJwt(cert, { publicKey: CERT })).toBe(true);
  });

  it("EdDSA with an Ed25519 key", async () => {
    const ed = generateKeyPairSync("ed25519");
    const t = token({ alg: "EdDSA" }, { a: 1 }, (d) => sign(null, Buffer.from(d), ed.privateKey));
    expect(await verifyJwt(t, { publicKey: ed.publicKey.export({ type: "spki", format: "pem" }) as string })).toBe(true);
  });

  it("explains unusable algorithms and keys", async () => {
    await expect(verifyJwt(token({ alg: "none" }, { a: 1 }, () => Buffer.alloc(0)), {})).rejects.toMatchObject({ code: "alg" });
    const t = token({ alg: "RS256" }, { a: 1 }, () => Buffer.from("x"));
    await expect(verifyJwt(t, { publicKey: "garbage" })).rejects.toMatchObject({ code: "key" });
    await expect(verifyJwt(t, { publicKey: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" })).rejects.toMatchObject({ code: "keyType" });
  });
});
