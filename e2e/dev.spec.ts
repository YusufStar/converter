import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { downloadAll, downloadOne, fixture, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles, test } from "./helpers";

test.use({
  permissions: ["clipboard-read", "clipboard-write"],
  // A fake camera that shows a QR code (for the live scanner test; harmless elsewhere).
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${fixture("dev-camera-qr.mjpeg")}`],
  },
});

const SLUGS = ["hash-generator", "uuid-generator", "jwt-decoder", "qr-code-generator", "barcode-generator", "qr-code-scanner", "subtitle-converter", "srt-to-vtt", "vtt-to-srt"];

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** Clicks a button that triggers a browser download and returns its bytes. */
async function download(page: Page, testId: string) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile(await dl.path())) };
}

/** Opens the scanner and reads one image, returning the decoded texts. */
async function scan(page: Page, name: string, bytes: Uint8Array, mimeType = "image/png") {
  await openTool(page, "qr-code-scanner");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType, buffer: Buffer.from(bytes) });
  const result = page.getByTestId("scan-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  return result;
}

test("every dev tool renders in English and Turkish, on desktop and phone widths, without errors", async ({ page }) => {
  const errors = trackErrors(page);
  for (const [lang, width] of [
    ["en", 1280],
    ["tr", 375],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate((l) => localStorage.setItem("converter.lang", l), lang);
    for (const slug of SLUGS) {
      await openTool(page, slug);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${slug} ${lang} ${width}`).toBeLessThanOrEqual(0);
    }
  }
  expect(errors).toEqual([]);
});

test("hash generator: streams files in workers, matches node:crypto, compares and exports", async ({ page }) => {
  const errors = trackErrors(page);
  const big = randomBytes(9 * 1024 * 1024 + 123); // crosses several 4 MB chunks
  const small = Buffer.from("hello world\n");
  const h = (algo: string, b: Buffer) => createHash(algo).update(b).digest("hex");

  await openTool(page, "hash-generator");
  // Add SHA3-256 to the default MD5 / SHA-1 / SHA-256 / SHA-512.
  await page.getByRole("button", { name: "SHA3-256" }).click();
  await page.getByTestId("file-input").setInputFiles([
    { name: "big.bin", mimeType: "application/octet-stream", buffer: big },
    { name: "hello.txt", mimeType: "text/plain", buffer: small },
  ]);
  await page.getByTestId("hash-expected").fill(h("sha256", big).toUpperCase());
  await page.getByTestId("run").click();
  const files = page.getByTestId("hash-file");
  await expect(files).toHaveCount(2, { timeout: 60_000 });

  for (const [i, buf] of [big, small].entries()) {
    const card = files.nth(i);
    for (const [algo, node] of [
      ["md5", "md5"],
      ["sha1", "sha1"],
      ["sha256", "sha256"],
      ["sha512", "sha512"],
      ["sha3-256", "sha3-256"],
    ])
      await expect(card.getByTestId(`digest-${algo}`).getByTestId("digest-value")).toHaveText(h(node, buf));
  }
  // The expected SHA-256 matches big.bin and not hello.txt; other algorithms stay neutral.
  await expect(files.nth(0).getByTestId("digest-sha256").getByTestId("digest-match")).toHaveText("Match");
  await expect(files.nth(1).getByTestId("digest-sha256").getByTestId("digest-match")).toHaveText("Mismatch");
  await expect(files.nth(0).getByTestId("digest-md5").getByTestId("digest-match")).toHaveCount(0);
  await expect(page.getByTestId("hash-stats")).toContainText("2 files");

  const out = await download(page, "hash-export");
  expect(out.name).toBe("checksums.txt");
  const text = dec(out.bytes);
  expect(text).toContain(`# SHA-256\n${h("sha256", big)}  big.bin\n${h("sha256", small)}  hello.txt\n`);
  expect(text).toContain(`# MD5\n${h("md5", big)}  big.bin`);

  // Base64 output.
  await page.getByRole("radio", { name: "Base64" }).click();
  await expect(files.nth(1).getByTestId("digest-sha256").getByTestId("digest-value")).toHaveText(createHash("sha256").update(small).digest("base64"));

  // Text mode hashes live, including CRC32 / xxHash64 / BLAKE3.
  await page.getByRole("radio", { name: "Text" }).click();
  await page.getByRole("radio", { name: "hex", exact: true }).click();
  for (const name of ["CRC32", "xxHash64", "BLAKE3"]) await page.getByRole("button", { name }).click();
  await page.getByTestId("hash-text").fill("123456789");
  const results = page.getByTestId("hash-results");
  await expect(results.getByTestId("digest-sha256").getByTestId("digest-value")).toHaveText(createHash("sha256").update("123456789").digest("hex"));
  await expect(results.getByTestId("digest-crc32").getByTestId("digest-value")).toHaveText("cbf43926");
  await expect(results.getByTestId("digest-xxh64").getByTestId("digest-value")).toHaveText("8cb841db40e6ae83");
  await expect(results.getByTestId("digest-blake3").getByTestId("digest-value")).toHaveText(/^[0-9a-f]{64}$/);
  await page.getByRole("radio", { name: "HEX", exact: true }).click();
  await expect(results.getByTestId("digest-md5").getByTestId("digest-value")).toHaveText("25F9E794323B453885F5181F1B624D0B");
  expect(errors).toEqual([]);
});

test("uuid generator: v7 bulk is sorted, ULID and NanoID formats, copy and download", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "uuid-generator");
  // One v4 by default, copyable.
  const single = await page.getByTestId("id-value").textContent();
  expect(single).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await page.getByTestId("id-single").getByRole("button", { name: "Copy" }).click();
  expect(await clipboard(page)).toBe(single);
  await page.getByTestId("id-regenerate").click();
  await expect(page.getByTestId("id-value")).not.toHaveText(single!);

  await page.getByRole("radio", { name: "UUID v7" }).click();
  await page.getByLabel("How many").fill("50");
  await page.getByRole("switch", { name: "Uppercase" }).check();
  const out = await download(page, "id-download");
  expect(out.name).toBe("uuid-v7.txt");
  const ids = dec(out.bytes).trim().split("\n");
  expect(ids).toHaveLength(50);
  for (const id of ids) expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-7[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  expect([...ids].sort()).toEqual(ids);

  await page.getByRole("switch", { name: "Hyphens" }).uncheck();
  await page.getByRole("switch", { name: "Braces { }" }).check();
  await expect(page.getByTestId("id-output")).toContainText(/^\{[0-9A-F]{32}\}/);

  await page.getByRole("radio", { name: "ULID" }).click();
  await page.getByTestId("id-list").getByRole("button", { name: "Copy" }).click();
  const ulids = (await clipboard(page)).split("\n");
  expect(ulids).toHaveLength(50);
  for (const id of ulids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect([...ulids].sort()).toEqual(ulids);

  await page.getByRole("radio", { name: "NanoID" }).click();
  await page.getByLabel("How many").fill("1");
  await page.getByRole("radio", { name: "0–9", exact: true }).click();
  await expect(page.getByTestId("id-value")).toHaveText(/^\d{21}$/);
  await expect(page.getByTestId("id-meta")).toContainText("bits");
  expect(errors).toEqual([]);
});

test("jwt decoder: decodes, flags expiry and verifies HS256 and ES256 signatures locally", async ({ page }) => {
  const errors = trackErrors(page);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "42", name: "Zeynep Çelik", iat: now - 7200, exp: now - 3600 })}`;
  const hs = `${body}.${createHmac("sha256", "s3cret").update(body).digest("base64url")}`;

  await openTool(page, "jwt-decoder");
  await expect(page.getByTestId("jwt-privacy")).toContainText("never leave this page");
  await page.getByTestId("jwt-input").fill(`Bearer ${hs}`);
  await expect(page.getByTestId("jwt-header")).toContainText('"alg": "HS256"');
  await expect(page.getByTestId("jwt-payload")).toContainText('"name": "Zeynep Çelik"');
  await expect(page.getByTestId("jwt-colored")).toHaveText(hs);
  await expect(page.getByTestId("jwt-status")).toHaveText("Expired");
  await expect(page.getByTestId("jwt-exp")).toContainText("1 hour ago");
  await expect(page.getByTestId("jwt-iat")).toContainText("2 hours ago");

  await expect(page.getByTestId("jwt-verdict")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("jwt-secret").fill("wrong");
  await expect(page.getByTestId("jwt-verdict")).toHaveText("Invalid signature");
  await page.getByTestId("jwt-secret").fill("s3cret");
  await expect(page.getByTestId("jwt-verdict")).toHaveText("Signature verified");

  // ES256 with a PEM public key; a far-future exp is valid.
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const esBody = `${b64({ alg: "ES256", kid: "k1" })}.${b64({ sub: "7", exp: now + 86_400 * 30 })}`;
  const es = `${esBody}.${sign("sha256", Buffer.from(esBody), { key: ec.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  await page.getByTestId("jwt-input").fill(es);
  await expect(page.getByTestId("jwt-status")).toHaveText("Valid now");
  await expect(page.getByTestId("jwt-alg")).toHaveText("ES256");
  await page.getByTestId("jwt-key").fill(ec.publicKey.export({ type: "spki", format: "pem" }) as string);
  await expect(page.getByTestId("jwt-verdict")).toHaveText("Signature verified");
  await page.getByTestId("jwt-key").fill(JSON.stringify({ keys: [{ ...ec.publicKey.export({ format: "jwk" }), kid: "k1" }] }));
  await expect(page.getByTestId("jwt-verdict")).toHaveText("Signature verified");
  await page.getByTestId("jwt-key").fill("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----");
  await expect(page.getByTestId("jwt-verdict")).toContainText("never a private key");

  await page.getByTestId("jwt-input").fill("not.a-token");
  await expect(page.getByRole("alert")).toContainText("three parts");
  expect(errors).toEqual([]);
});

test("QR generator → PNG → scanner round trip, with Unicode text, colours and a centre logo", async ({ page }) => {
  const errors = trackErrors(page);
  const text = "Merhaba dünya — ğüşıöç İŞĞ 🎉 https://example.com/?q=1";
  await openTool(page, "qr-code-generator");
  await page.getByTestId("qr-text").fill(text);
  await expect(page.getByTestId("qr-payload")).toContainText("ğüşıöç");
  await page.getByRole("radio", { name: "Q · 25%" }).click();

  const png = await download(page, "qr-png");
  expect(png.name).toBe("qr-code.png");
  expect(sniff(png.bytes)).toBe("png");
  expect(imageSize(png.bytes).width).toBe(1024);
  const svg = await download(page, "qr-svg");
  expect(svg.name).toBe("qr-code.svg");
  expect(dec(svg.bytes)).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);

  // A logo forces error correction H, and the code still scans.
  await page.getByTestId("qr-logo-input").setInputFiles(fixture("logo.png"));
  await expect(page.getByRole("radio", { name: "H · 30%" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "L · 7%" })).toBeDisabled();
  const withLogo = await download(page, "qr-png");

  const result = await scan(page, "qr-code.png", png.bytes);
  await expect(result.getByTestId("scan-text")).toHaveText(text);
  await expect(result.getByTestId("scan-format")).toHaveText("QR Code");
  await expect(result.locator("polygon")).toHaveCount(1);

  const logoResult = await scan(page, "qr-logo.png", withLogo.bytes);
  await expect(logoResult.getByTestId("scan-text")).toHaveText(text);
  expect(errors).toEqual([]);
});

test("QR generator: Wi-Fi, contact and location templates build the standard payloads", async ({ page }) => {
  await openTool(page, "qr-code-generator");
  await page.getByRole("radio", { name: "Wi-Fi" }).click();
  await expect(page.getByTestId("qr-preview")).toContainText("Fill in the fields");
  await page.getByTestId("qr-ssid").fill("Ev;Ağı");
  await page.getByLabel("Password").fill("p@ss:word");
  await expect(page.getByTestId("qr-payload")).toHaveText("WIFI:T:WPA;S:Ev\\;Ağı;P:p@ss\\:word;;");

  await page.getByRole("radio", { name: "Contact" }).click();
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByLabel("Company").fill("Analytical, Ltd");
  await expect(page.getByTestId("qr-payload")).toContainText("FN:Ada Lovelace");
  await expect(page.getByTestId("qr-payload")).toContainText("ORG:Analytical\\, Ltd");

  await page.getByRole("radio", { name: "Location" }).click();
  await page.getByLabel("Latitude").fill("41.0082");
  await page.getByLabel("Longitude").fill("28.9784");
  await expect(page.getByTestId("qr-payload")).toHaveText("geo:41.0082,28.9784");
  const png = await download(page, "qr-png");
  const result = await scan(page, "geo.png", png.bytes);
  await expect(result.getByTestId("scan-text")).toHaveText("geo:41.0082,28.9784");
});

test("barcode generator: EAN-13 check digit, PNG scans back; errors explained; SVG for 2D", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "barcode-generator");
  await page.getByRole("radio", { name: "EAN-13" }).click();
  const input = page.getByTestId("barcode-input");
  await input.fill("5901234123458");
  await expect(page.getByTestId("barcode-message")).toContainText("should be 7");
  await expect(page.getByTestId("barcode-png")).toBeDisabled();
  await input.fill("59012341234a");
  await expect(page.getByTestId("barcode-message")).toContainText("Only digits");
  await input.fill("590123412345");
  await expect(page.getByTestId("barcode-message")).toContainText("Check digit 7 added");
  await expect(page.getByTestId("barcode-encoded")).toContainText("5901234123457");
  const png = await download(page, "barcode-png");
  expect(png.name).toBe("ean13-5901234123457.png");
  expect(sniff(png.bytes)).toBe("png");
  const svg = await download(page, "barcode-svg");
  expect(dec(svg.bytes)).toContain("<svg");
  expect(dec(svg.bytes)).toContain("901234"); // human-readable text

  await page.getByRole("radio", { name: "Data Matrix" }).click();
  await input.fill("Data Matrix — ğüş");
  const dm = await download(page, "barcode-png");

  let result = await scan(page, "ean.png", png.bytes);
  await expect(result.getByTestId("scan-text")).toHaveText("5901234123457");
  await expect(result.getByTestId("scan-format")).toHaveText("EAN-13");
  result = await scan(page, "dm.png", dm.bytes);
  await expect(result.getByTestId("scan-text")).toHaveText("Data Matrix — ğüş");
  await expect(result.getByTestId("scan-format")).toHaveText("Data Matrix");
  expect(errors).toEqual([]);
});

test("barcode generator: Code 39 and ITF normalise input; they and Code 128 scan back", async ({ page }) => {
  await openTool(page, "barcode-generator");
  const input = page.getByTestId("barcode-input");
  const cases: [string, string, string, string][] = [
    ["Code 39", "abc-123", "ABC-123", "upper case"],
    ["ITF", "12345", "012345", "leading 0"],
    ["Code 128", "Hello, 128!", "Hello, 128!", ""],
  ];
  for (const [kind, value, expected, note] of cases) {
    await openTool(page, "barcode-generator");
    await page.getByRole("radio", { name: kind, exact: true }).click();
    await input.fill(value);
    if (note) await expect(page.getByTestId("barcode-message")).toContainText(note);
    const png = await download(page, "barcode-png");
    const result = await scan(page, `${kind}.png`, png.bytes);
    await expect(result.getByTestId("scan-text")).toHaveText(expected);
  }
});

test("scanner: several codes in one image, boxes drawn, copy all, and images without codes", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "qr-code-scanner");
  await uploadFiles(page, ["dev-two-codes.png", "photo.jpg"]);
  const results = page.getByTestId("scan-result");
  await expect(results).toHaveCount(2, { timeout: 30_000 });
  const two = results.nth(0);
  await expect(two.getByTestId("scan-text")).toHaveText(["first code", "second code"]);
  await expect(two.locator("polygon")).toHaveCount(2);
  await expect(results.nth(1).getByTestId("scan-empty")).toBeVisible();
  await page.getByRole("button", { name: "Copy", exact: true }).first().click();
  expect(await clipboard(page)).toBe("first code\nsecond code");
  expect(errors).toEqual([]);
});

test.describe("camera", () => {
  test.use({ permissions: ["camera"] });

  test("scanner reads a QR code live from the camera", async ({ page }) => {
    const errors = trackErrors(page);
    await openTool(page, "qr-code-scanner");
    await page.getByRole("radio", { name: "Camera" }).click();
    await page.getByTestId("scan-start").click();
    const found = page.getByTestId("camera-results");
    await expect(found.getByTestId("scan-text")).toHaveText("https://example.com/camera-test", { timeout: 30_000 });
    await expect(found.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://example.com/camera-test");
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByTestId("scan-start")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test("subtitles: Windows-1254 SRT → UTF-8 VTT with a shift, Turkish letters intact", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "srt-to-vtt");
  await expect(page.getByRole("radio", { name: "VTT" })).toHaveAttribute("aria-checked", "true");
  await uploadFiles(page, ["dev-turkish-1254.srt"]);
  await page.getByLabel("Time shift").fill("1500");
  await runAndWait(page);
  await expect(page.getByTestId("results")).toContainText("Windows-1254");
  await expect(page.getByTestId("subtitle-preview")).toContainText("Günaydın");
  const out = await downloadOne(page);
  expect(out.name).toBe("dev-turkish-1254.vtt");
  expect(dec(out.bytes)).toBe(
    "WEBVTT\n\n00:00:02.500 --> 00:00:05.000\n<i>Günaydın</i>, İstanbul!\n\n00:00:05.500 --> 00:00:07.500\nŞu ağaçların ışığı çok güzel.\n\n00:01:01.750 --> 00:01:03.500\nĞ ğ Ü ü Ş ş İ ı Ö ö Ç ç\n",
  );
  expect(errors).toEqual([]);
});

test("subtitles: VTT, ASS and MicroDVD batch → SRT zip; forced encoding and FPS conversion", async ({ page }) => {
  await openTool(page, "subtitle-converter");
  await uploadFiles(page, ["dev-captions.vtt", "dev-styled.ass", "dev-microdvd.sub"]);
  await expect(page.getByText("MicroDVD frame rate")).toBeVisible();
  await runAndWait(page);
  const zip = await downloadAll(page);
  expect(zip.name).toBe("subtitles.zip");
  const files = Object.fromEntries(Object.entries(zip.entries).map(([k, v]) => [k, dec(v)]));
  expect(files["dev-captions.srt"]).toBe("1\n00:00:00,500 --> 00:00:02,000\nHello & welcome\n\n2\n00:00:02,500 --> 00:00:04,000\n<i>Second</i> line\n");
  expect(files["dev-styled.srt"]).toBe("1\n00:00:00,200 --> 00:00:01,000\n<i>Merhaba</i>\ndünya\n\n2\n00:00:01,000 --> 00:00:02,500\nTop sign\n");
  // The file declares 25 fps: frame 25 = 1 s.
  expect(files["dev-microdvd.srt"]).toBe("1\n00:00:01,000 --> 00:00:03,000\nMicroDVD\ntwo lines\n\n2\n00:00:04,000 --> 00:00:06,000\n<i>italic</i>\n");

  // Forcing Western (1252) on the Turkish file shows the classic mojibake; FPS 25 → 23.976 stretches times.
  await openTool(page, "vtt-to-srt");
  await uploadFiles(page, ["dev-turkish-1254.srt"]);
  await page.getByRole("radio", { name: "Western (1252)" }).click();
  await page.getByRole("switch", { name: "Frame rate conversion" }).check();
  await page.getByRole("radiogroup", { name: "Subtitles made for" }).getByRole("radio", { name: "25" }).click();
  await page.getByRole("radiogroup", { name: "Your video" }).getByRole("radio", { name: "23.976" }).click();
  await runAndWait(page);
  const out = dec((await downloadOne(page)).bytes);
  expect(out).toContain("00:00:01,043 --> 00:00:03,649");
  expect(out).toContain("Ýstanbul");
});
