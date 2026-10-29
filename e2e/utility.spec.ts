import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { fixture, openTool, trackErrors } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

const SLUGS = [
  "unit-converter",
  "color-converter",
  "base64-converter",
  "image-to-base64",
  "url-encoder",
  "number-base-converter",
  "timestamp-converter",
  "text-case-converter",
  "roman-numeral-converter",
  "number-to-words",
  "percentage-calculator",
];

test("every quick converter renders in English and Turkish without errors", async ({ page }) => {
  const errors = trackErrors(page);
  for (const lang of ["en", "tr"]) {
    await page.goto("/");
    await page.evaluate((l) => localStorage.setItem("converter.lang", l), lang);
    for (const slug of SLUGS) {
      await openTool(page, slug);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${slug} ${lang}`).toBeLessThanOrEqual(0);
    }
  }
  expect(errors).toEqual([]);
});

test("unit converter: miles to km, temperature, swap, table pick and copy", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "unit-converter");
  await page.getByTestId("unit-from-select").selectOption("mi");
  await page.getByTestId("unit-to-select").selectOption("km");
  await page.getByTestId("unit-from").fill("1");
  await expect(page.getByTestId("unit-to")).toHaveValue("1.609344");
  await expect(page.getByTestId("unit-summary")).toContainText("1 mi = 1.609344 km");
  // The table lists every length unit; feet is 5280.
  await expect(page.getByTestId("unit-row-ft")).toContainText("5,280");

  // Typing on the "to" side converts backwards.
  await page.getByTestId("unit-to").fill("16.09344");
  await expect(page.getByTestId("unit-from")).toHaveValue("10");

  await page.getByRole("radio", { name: "Temperature" }).click();
  await page.getByTestId("unit-from").fill("100");
  await expect(page.getByTestId("unit-to")).toHaveValue("212");
  await page.getByTestId("unit-swap").click();
  await expect(page.getByTestId("unit-from")).toHaveValue("212");
  await expect(page.getByTestId("unit-to")).toHaveValue("100");

  // Clicking a table row makes it the target unit.
  await page.getByTestId("unit-row-k").locator("button[aria-pressed]").click();
  await expect(page.getByTestId("unit-to")).toHaveValue("373.15");

  await page.getByTestId("unit-summary").locator("..").locator("..").getByRole("button").click();
  expect(await clipboard(page)).toBe("373.15");

  await page.getByRole("radio", { name: "Data size" }).click();
  await page.getByTestId("unit-from-select").selectOption("kib");
  await page.getByTestId("unit-to-select").selectOption("b");
  await page.getByTestId("unit-from").fill("1");
  await expect(page.getByTestId("unit-to")).toHaveValue("1024");

  await page.getByTestId("unit-from").fill("abc");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(errors).toEqual([]);
});

test("colour converter: parses any notation, shows every format and contrast", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "color-converter");
  const input = page.getByTestId("color-input");
  await input.fill("rgb(255, 107, 44)");
  await expect(page.getByTestId("fmt-hex")).toHaveText("#ff6b2c");
  await expect(page.getByTestId("fmt-hsl")).toHaveText("hsl(17.9, 100%, 58.6%)");
  await expect(page.getByTestId("fmt-oklch")).toHaveText("oklch(70.38% 0.1946 40.92)");
  await expect(page.getByTestId("fmt-name")).toContainText("tomato");
  await expect(page.getByTestId("contrast-white")).toHaveText("2.84:1");
  await expect(page.getByTestId("contrast-black")).toHaveText("7.39:1");

  await input.fill("rebeccapurple");
  await expect(page.getByTestId("fmt-hex")).toHaveText("#663399");
  await input.fill("hsl(120deg 100% 25% / 50%)");
  await expect(page.getByTestId("fmt-hex")).toHaveText("#00800080");
  await expect(page.getByTestId("fmt-rgb")).toHaveText("rgba(0, 128, 0, 0.5)");

  await input.fill("not a colour");
  await expect(page.getByRole("alert")).toBeVisible();
  // The last valid colour stays on screen.
  await expect(page.getByTestId("fmt-hex")).toHaveText("#00800080");

  await page.getByTestId("color-picker").fill("#3366cc");
  await expect(input).toHaveValue("#3366cc");
  await page.getByTestId("fmt-hex").locator("../../..").getByRole("button").click();
  expect(await clipboard(page)).toBe("#3366cc");

  await page.getByTestId("color-random").click();
  await expect(page.getByTestId("fmt-hex")).toHaveText(/^#[0-9a-f]{6}$/);
  expect(errors).toEqual([]);
});

test("base64: UTF-8 text both ways, URL-safe, errors", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "base64-converter");
  const plain = page.getByTestId("pane-plain");
  const encoded = page.getByTestId("pane-encoded");
  await plain.fill("ğüşıöç");
  await expect(encoded).toHaveValue("xJ/DvMWfxLHDtsOn");
  await page.getByRole("switch", { name: /URL-safe/ }).check({ force: true });
  await expect(encoded).toHaveValue("xJ_DvMWfxLHDtsOn");

  await encoded.fill("SGVsbG8sIOWklumDqA==");
  await expect(plain).toHaveValue("Hello, 外部");

  await encoded.fill("not base64!");
  await expect(page.getByRole("alert")).toContainText("valid Base64");

  await plain.fill("copy me");
  await page.getByRole("button", { name: "Copy Base64" }).click();
  expect(await clipboard(page)).toBe("Y29weSBtZQ");
  expect(errors).toEqual([]);
});

test("image to base64: file becomes a data URI", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "image-to-base64");
  await page.getByTestId("file-input").setInputFiles(fixture("logo.png"));
  const expected = `data:image/png;base64,${(await readFile(fixture("logo.png"))).toString("base64")}`;
  await expect(page.getByTestId("file-b64-output")).toHaveValue(expected);
  await page.getByTestId("file-b64").getByRole("button", { name: "Copy" }).click();
  expect(await clipboard(page)).toBe(expected);

  await page.getByTestId("file-b64").getByRole("radio", { name: "CSS" }).click();
  await expect(page.getByTestId("file-b64-output")).toHaveValue(`background-image: url("${expected}");`);
  expect(errors).toEqual([]);
});

test("base64 to file: detects the type and downloads the original bytes", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "base64-converter");
  await page.getByRole("radio", { name: "Base64 → File" }).click();
  const png = await readFile(fixture("logo.png"));
  // Raw Base64 without a data URI: the type comes from the magic bytes.
  await page.getByTestId("b64-paste").fill(png.toString("base64"));
  await expect(page.getByTestId("b64-mime")).toHaveText("image/png");
  await expect(page.getByTestId("b64-preview")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("b64-download").click()]);
  expect(dl.suggestedFilename()).toBe("decoded.png");
  expect(Buffer.compare(await readFile(await dl.path()), png)).toBe(0);

  await page.getByTestId("b64-paste").fill("data:application/pdf;base64,JVBERi0xLjQ=");
  await expect(page.getByTestId("b64-mime")).toHaveText("application/pdf");
  expect(errors).toEqual([]);
});

test("url encoder: component vs full URL and query parameters", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "url-encoder");
  const plain = page.getByTestId("pane-plain");
  const encoded = page.getByTestId("pane-encoded");
  await plain.fill("a b&c=ç");
  await expect(encoded).toHaveValue("a%20b%26c%3D%C3%A7");
  await page.getByRole("radio", { name: "Full URL" }).click();
  await plain.fill("https://example.com/a b?q=çay&n=2");
  await expect(encoded).toHaveValue("https://example.com/a%20b?q=%C3%A7ay&n=2");
  await expect(page.getByTestId("url-parts")).toContainText("example.com");
  await expect(page.getByTestId("url-parts")).toContainText("çay");

  await encoded.fill("%E0%A4%A");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(errors).toEqual([]);
});

test("html entities and hex tabs", async ({ page }) => {
  await openTool(page, "base64-converter");
  await page.getByRole("radio", { name: "HTML" }).click();
  await page.getByTestId("pane-plain").fill('<a href="x">Tom & Jerry</a>');
  await expect(page.getByTestId("pane-encoded")).toHaveValue("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;");
  await page.getByTestId("pane-encoded").fill("&copy; &#231;ay &euro;");
  await expect(page.getByTestId("pane-plain")).toHaveValue("© çay €");

  await page.getByRole("radio", { name: "Hex" }).click();
  await page.getByTestId("pane-plain").fill("Hi ğ");
  await expect(page.getByTestId("pane-encoded")).toHaveValue("48 69 20 c4 9f");
  await page.getByTestId("pane-encoded").fill("0x48 0x65 0x79");
  await expect(page.getByTestId("pane-plain")).toHaveValue("Hey");
});

test("number base converter: 2^64, prefixes, two's complement, validation", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "number-base-converter");
  const input = page.getByTestId("base-input");
  await input.fill("18446744073709551616");
  await expect(page.getByTestId("base-16")).toHaveText("1 0000 0000 0000 0000");
  await expect(page.getByTestId("base-8")).toHaveText("2 000 000 000 000 000 000 000");
  await expect(page.getByTestId("base-36")).toHaveText("3 w5e1 1264 sgsg");
  await page.getByTestId("base-16").locator("../../..").getByRole("button").click();
  expect(await clipboard(page)).toBe("10000000000000000");

  await input.fill("0xff");
  await expect(page.getByTestId("base-10")).toHaveText("255");
  await expect(page.getByTestId("base-2")).toHaveText("1111 1111");

  await input.fill("-1");
  await expect(page.getByTestId("twos-8")).toHaveText("1111 1111");
  await expect(page.getByTestId("twos-16")).toContainText("1111 1111 1111 1111");

  await page.getByRole("radio", { name: "Binary" }).click();
  await input.fill("102");
  await expect(page.getByRole("alert")).toContainText("“2”");
  expect(errors).toEqual([]);
});

test("timestamp converter: epoch, ms auto-detect, ISO input, zones, now", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "timestamp-converter");
  const input = page.getByTestId("ts-input");
  await input.fill("0");
  await expect(page.getByTestId("ts-iso")).toHaveText("1970-01-01T00:00:00.000Z");
  await expect(page.getByTestId("ts-utc")).toHaveText("Thu, 01 Jan 1970 00:00:00 GMT");

  await input.fill("1761748200000");
  await expect(page.getByTestId("ts-detected")).toContainText("milliseconds");
  await expect(page.getByTestId("ts-unix-s")).toHaveText("1761748200");
  await expect(page.getByTestId("ts-iso")).toHaveText("2025-10-29T14:30:00.000Z");

  await page.getByTestId("ts-zone").selectOption("Asia/Tokyo");
  await expect(page.getByTestId("ts-zone-time").locator("..")).toContainText("2025-10-29T23:30:00.000+09:00");

  await input.fill("2026-10-29T17:30:00+03:00");
  await expect(page.getByTestId("ts-unix-s")).toHaveText("1793284200");

  await page.getByTestId("ts-now").click();
  await expect(page.getByTestId("ts-relative")).toHaveText(/now|second/);

  await input.fill("yesterday-ish");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(errors).toEqual([]);
});

test("text case converter: all cases, counts and Turkish rules", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "text-case-converter");
  await page.getByTestId("case-input").fill("hello world from XMLHttpRequest");
  await expect(page.getByTestId("case-out-camel")).toHaveText("helloWorldFromXmlHttpRequest");
  await expect(page.getByTestId("case-out-snake")).toHaveText("hello_world_from_xml_http_request");
  await expect(page.getByTestId("case-out-kebab")).toHaveText("hello-world-from-xml-http-request");
  await expect(page.getByTestId("case-out-constant")).toHaveText("HELLO_WORLD_FROM_XML_HTTP_REQUEST");
  await expect(page.getByTestId("case-stats")).toContainText("31");

  await page.getByTestId("case-input").fill("istanbul ılık");
  await expect(page.getByTestId("case-out-upper")).toHaveText("ISTANBUL ILIK");
  await page.getByRole("switch", { name: /Turkish rules/ }).check({ force: true });
  await expect(page.getByTestId("case-out-upper")).toHaveText("İSTANBUL ILIK");

  await page.getByTestId("case-upper").getByRole("button").click();
  expect(await clipboard(page)).toBe("İSTANBUL ILIK");
  expect(errors).toEqual([]);
});

test("text case follows the Turkish UI by default", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("converter.lang", "tr"));
  await openTool(page, "text-case-converter");
  await page.getByTestId("case-input").fill("iyi günler");
  await expect(page.getByTestId("case-out-upper")).toHaveText("İYİ GÜNLER");
});

test("roman numerals, number to words and percentages", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "roman-numeral-converter");
  await page.getByTestId("roman-input").fill("1994");
  await expect(page.getByTestId("roman-out")).toHaveText("MCMXCIV");
  await page.getByTestId("roman-input").fill("mmxxvi");
  await expect(page.getByTestId("roman-number")).toHaveText("2,026");
  await page.getByTestId("roman-input").fill("IIII");
  await expect(page.getByRole("alert")).toBeVisible();

  await openTool(page, "number-to-words");
  await page.getByTestId("words-input").fill("1234.56");
  await expect(page.getByTestId("words-out")).toHaveText("one thousand two hundred thirty-four point five six");
  await page.getByRole("radio", { name: "Türkçe" }).click();
  await expect(page.getByTestId("words-out")).toHaveText("bin iki yüz otuz dört virgül elli altı");
  await page.getByRole("switch", { name: /money/ }).check({ force: true });
  await expect(page.getByTestId("words-out")).toHaveText("bin iki yüz otuz dört Türk lirası elli altı kuruş");

  await openTool(page, "percentage-calculator");
  await expect(page.getByTestId("pct-of-out")).toHaveText("30");
  await expect(page.getByTestId("pct-what-out")).toHaveText("15%");
  await expect(page.getByTestId("pct-change-out")).toHaveText("25% increase");
  await page.getByTestId("pct-what").getByLabel("Total (Y)").fill("0");
  await expect(page.getByTestId("pct-what-out")).toContainText("zero");
  expect(errors).toEqual([]);
});
