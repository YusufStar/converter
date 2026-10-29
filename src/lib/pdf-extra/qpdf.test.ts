// Drives the real qpdf wasm build in Node and checks the results with pdf.js.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_ALLOWED, WRONG_PASSWORD, createQpdf, decryptArgs, encryptArgs, outputOf, parseStatus, statusArgs, type Qpdf, type QpdfFactory } from "./qpdf";

const root = new URL("../../../", import.meta.url);
const require = createRequire(root);
let qpdf: Qpdf;
let sample: Uint8Array;

beforeAll(async () => {
  const factory = require("@neslinesli93/qpdf-wasm") as QpdfFactory;
  qpdf = await createQpdf(factory, new URL("node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm", root).pathname);
  sample = new Uint8Array(await readFile(new URL("e2e/fixtures/sample.pdf", root)));
});

// In Node the glue reports qpdf's exit status through process.exitCode.
afterAll(() => {
  process.exitCode = 0;
});

async function open(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
  return { pages: doc.numPages, text, permissions: await doc.getPermissions() };
}

const pdfjsError = (bytes: Uint8Array, password?: string) => open(bytes, password).then(() => null, (e: Error) => e.name);

describe("qpdf", () => {
  it("encrypts with AES-256: pdf.js needs the password, then reads every page", async () => {
    const out = outputOf(qpdf.run(encryptArgs("geheim", "owner", { ...ALL_ALLOWED, print: false, copy: false }), sample));
    expect(new TextDecoder("latin1").decode(out)).toContain("/Encrypt");
    expect(await pdfjsError(out)).toBe("PasswordException");
    expect(await pdfjsError(out, "nope")).toBe("PasswordException");
    const opened = await open(out, "geheim");
    expect(opened.pages).toBe(3);
    expect(opened.text).toBe("Page 1 of the sample document");
    // pdf.js lists the allowed permission bits: print (4) and copy (16) are missing.
    expect([...(opened.permissions ?? [])].sort((a, b) => a - b)).toEqual([8, 32, 256, 512, 1024]);
    expect(parseStatus(qpdf.run(statusArgs(), out))).toBe("locked");
  });

  it("decrypts with the right password and refuses a wrong one", async () => {
    const locked = outputOf(qpdf.run(encryptArgs("geheim", "owner", ALL_ALLOWED), sample));
    expect(() => outputOf(qpdf.run(decryptArgs("wrong"), locked))).toThrow(WRONG_PASSWORD);
    // The same instance keeps working after a failed command.
    const open1 = outputOf(qpdf.run(decryptArgs("geheim"), locked));
    expect(await pdfjsError(open1)).toBeNull();
    expect(await open(open1)).toMatchObject({ pages: 3, text: "Page 1 of the sample document" });
    expect(parseStatus(qpdf.run(statusArgs(), open1))).toBe("none");
  });

  it("tells apart restricted-only files and removes their restrictions without a password", async () => {
    const restricted = outputOf(qpdf.run(encryptArgs("", "owner", { ...ALL_ALLOWED, print: false }), sample));
    expect(parseStatus(qpdf.run(statusArgs(), restricted))).toBe("restricted");
    const free = outputOf(qpdf.run(decryptArgs(""), restricted));
    expect(new TextDecoder("latin1").decode(free)).not.toContain("/Encrypt");
    expect((await open(free)).permissions).toBeNull();
  });

  it("reports damaged input as not a PDF", () => {
    const r = qpdf.run(statusArgs(), new TextEncoder().encode("hello"));
    expect(() => parseStatus(r)).toThrow(/isn't a readable PDF/);
  });

  it("maps permissions to qpdf flags", () => {
    expect(encryptArgs("u", "o", { print: false, copy: true, modify: false, annotate: true, forms: false })).toEqual([
      "--encrypt",
      "--user-password=u",
      "--owner-password=o",
      "--bits=256",
      "--print=none",
      "--extract=y",
      "--modify-other=n",
      "--assemble=n",
      "--annotate=y",
      "--form=n",
      "--",
      "/in.pdf",
      "/out.pdf",
    ]);
  });
});
