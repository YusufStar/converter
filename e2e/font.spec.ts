import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import fonteditor, { woff2 } from "fonteditor-core";
import { downloadAll, downloadOne, fixture, openTool, runAndWait, trackErrors, uploadFiles } from "./helpers";

await woff2.init();

const magic = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 4));
const ab = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
/** Glyph count and family of a TTF / OTF / WOFF2 font, read back with fonteditor-core in Node. */
function read(b: Uint8Array) {
  const sfnt = magic(b) === "wOF2" ? woff2.decode(ab(b)) : b;
  const font = fonteditor.createFont(ab(sfnt), { type: magic(sfnt) === "OTTO" ? "otf" : "ttf" }).get();
  return { glyphs: font.glyf.length, family: font.name.fontFamily };
}

async function uploadBuffer(page: Page, name: string, buffer: Uint8Array) {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(buffer) });
  await expect(page.getByTestId("queue").locator("li")).toHaveCount(1);
}

test("font converter: info, live preview, batch WOFF2 and @font-face CSS", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "font-converter");
  await uploadFiles(page, ["font-sample.ttf", "font-sample.otf"]);

  const preview = page.getByTestId("font-preview");
  await expect(preview.getByTestId("font-info")).toHaveText([/^DejaVu Sans · Book · 123 glyphs · 26\.3 KB$/, /^DejaVu Sans OT · Book · 123 glyphs/]);
  await expect(preview.getByTestId("font-sample")).toHaveCount(2);
  await expect(preview.getByTestId("font-sample").first()).toHaveText(/^The quick brown fox/);
  // The sample really renders with the uploaded font, not a fallback.
  const family = await preview.getByTestId("font-sample").first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await page.evaluate((f) => document.fonts.check(`16px ${f.split(",")[0]}`), family)).toBe(true);
  await page.getByTestId("sample-text").fill("Merhaba ğüşıöç");
  await expect(preview.getByTestId("font-sample").first()).toHaveText("Merhaba ğüşıöç");

  await runAndWait(page);
  await expect(page.getByTestId("results")).toContainText("DejaVu Sans · Book · 123 glyphs");
  const { name, entries } = await downloadAll(page);
  expect(name).toBe("fonts.zip");
  expect(Object.keys(entries).sort()).toEqual(["font-sample (2).woff2", "font-sample.woff2"]);
  for (const b of Object.values(entries)) {
    expect(magic(b)).toBe("wOF2");
    expect(read(b).glyphs).toBe(123);
  }
  const css = page.getByTestId("font-css");
  await expect(css).toContainText('font-family: "DejaVu Sans";');
  await expect(css).toContainText('src: url("font-sample.woff2") format("woff2");');
  await expect(css).toContainText('font-family: "DejaVu Sans OT";\n  src: url("font-sample%20(2).woff2") format("woff2");');
  await expect(page.getByText("Preview · converted")).toBeVisible();
  expect(errors).toEqual([]);
});

test("ttf-to-woff2 → woff2-to-ttf round trip keeps every glyph", async ({ page }) => {
  await openTool(page, "ttf-to-woff2");
  await uploadFiles(page, ["font-sample.ttf"]);
  await runAndWait(page);
  const w2 = await downloadOne(page);
  expect(w2.name).toBe("font-sample.woff2");
  expect(magic(w2.bytes)).toBe("wOF2");
  expect(w2.bytes.length).toBeLessThan((await readFile(fixture("font-sample.ttf"))).length);

  await openTool(page, "woff2-to-ttf");
  await uploadBuffer(page, "font-sample.woff2", w2.bytes);
  await runAndWait(page);
  const ttf = await downloadOne(page);
  expect(ttf.name).toBe("font-sample.ttf");
  expect([...ttf.bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
  expect(read(ttf.bytes)).toEqual({ glyphs: 123, family: "DejaVu Sans" });
});

test("ttf-to-woff → woff-to-ttf gives the original bytes back", async ({ page }) => {
  await openTool(page, "ttf-to-woff");
  await uploadFiles(page, ["font-sample.ttf"]);
  await runAndWait(page);
  const woff = await downloadOne(page);
  expect(magic(woff.bytes)).toBe("wOFF");

  await openTool(page, "woff-to-ttf");
  await uploadBuffer(page, "font-sample.woff", woff.bytes);
  await runAndWait(page);
  expect(Buffer.from((await downloadOne(page)).bytes)).toEqual(await readFile(fixture("font-sample.ttf")));
});

test("otf-to-ttf converts CFF outlines; otf-to-woff2 keeps them", async ({ page }) => {
  await openTool(page, "otf-to-ttf");
  await uploadFiles(page, ["font-sample.otf"]);
  await runAndWait(page);
  const ttf = await downloadOne(page);
  expect(ttf.name).toBe("font-sample.ttf");
  expect([...ttf.bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
  expect(read(ttf.bytes)).toEqual({ glyphs: 123, family: "DejaVu Sans OT" });

  await openTool(page, "otf-to-woff2");
  await uploadFiles(page, ["font-sample.otf"]);
  await runAndWait(page);
  const w2 = await downloadOne(page);
  expect(magic(woff2.decode(ab(w2.bytes)))).toBe("OTTO");
});

test("subsetting keeps only the chosen characters and adds unicode-range", async ({ page }) => {
  await openTool(page, "font-converter");
  await uploadFiles(page, ["font-sample.ttf"]);
  await page.getByRole("radio", { name: "TTF" }).click();
  await page.getByRole("radio", { name: "Custom" }).click();
  await expect(page.getByTestId("run")).toBeDisabled();
  await page.getByTestId("subset-chars").fill("Ağ");
  await runAndWait(page);
  await expect(page.getByTestId("results")).toContainText("(was 123)");
  const out = await downloadOne(page);
  const font = fonteditor.createFont(ab(out.bytes), { type: "ttf" }).get();
  const unicodes = font.glyf.flatMap((g) => g.unicode ?? []);
  expect(unicodes).toEqual(expect.arrayContaining([0x20, 0x41, 0x11f]));
  expect(unicodes).not.toContain(0x42);
  expect(font.glyf.length).toBeLessThan(10);
  await expect(page.getByTestId("font-css")).toContainText("unicode-range: U+20, U+41, U+11F;");
});

test("EOT and SVG font outputs; Turkish UI uses a Turkish pangram", async ({ page }) => {
  await page.goto("/tr/font-converter");
  await uploadFiles(page, ["font-sample.ttf"]);
  await expect(page.getByTestId("font-sample")).toHaveText(/ğ/);
  for (const ch of "ğüşıöç") await expect(page.getByTestId("sample-text")).toHaveValue(new RegExp(ch));

  await page.getByRole("radio", { name: "EOT" }).click();
  await runAndWait(page);
  const eot = await downloadOne(page);
  expect(eot.name).toBe("font-sample.eot");
  expect([eot.bytes[34], eot.bytes[35]]).toEqual([0x4c, 0x50]);

  await page.getByRole("radio", { name: "SVG" }).click();
  await runAndWait(page);
  const svg = await downloadOne(page);
  expect(svg.name).toBe("font-sample.svg");
  const text = new TextDecoder().decode(svg.bytes);
  expect(text).toContain("<font");
  expect(fonteditor.createFont(text, { type: "svg" }).get().glyf.length).toBeGreaterThan(100);
});

test("a non-font file is refused with a clear message", async ({ page }) => {
  await openTool(page, "font-converter");
  await uploadBuffer(page, "fake.ttf", new TextEncoder().encode("definitely not a font"));
  await expect(page.getByTestId("font-preview")).toContainText("Not a font file");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("queue")).toContainText("Not a font file");
});
