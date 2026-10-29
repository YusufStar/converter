import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { gunzipSync, gzipSync, unzipSync, zipSync } from "fflate";
import { downloadAll, downloadOne, fixture, openTool, runAndWait, sniff, trackErrors, uploadFiles } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function uploadBuffer(page: Page, name: string, buffer: Uint8Array) {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(buffer) });
  await expect(page.getByTestId("queue").locator("li")).toHaveCount(1);
}

const nestedZip = () =>
  zipSync({
    "docs/": new Uint8Array(0),
    "docs/readme.md": enc("# Merhaba"),
    "img/a/note.txt": enc("ğüşıöç"),
    "top.txt": enc("top"),
    "__MACOSX/docs/._readme.md": enc("junk"),
  });

test("zip creator: archive name, store level, exact contents", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "zip-creator");
  await uploadFiles(page, ["data.csv", "data.json", "notes.txt"]);
  await page.getByTestId("archive-name").fill("bundle");
  await page.getByRole("radio", { name: "Store" }).click();
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("bundle.zip");
  expect(sniff(out.bytes)).toBe("zip");
  const entries = unzipSync(out.bytes);
  expect(Object.keys(entries).sort()).toEqual(["data.csv", "data.json", "notes.txt"]);
  for (const name of Object.keys(entries)) expect(Buffer.from(entries[name])).toEqual(await readFile(fixture(name)));
  expect(errors).toEqual([]);
});

test("unzip keeps folders by default and can flatten them", async ({ page }) => {
  await openTool(page, "unzip");
  await uploadBuffer(page, "site.zip", nestedZip());
  await runAndWait(page);
  const results = page.getByTestId("results");
  await expect(results.locator("li")).toHaveCount(3);
  await expect(results).toContainText("img/a/note.txt");
  const kept = await downloadAll(page);
  expect(kept.name).toBe("site.zip");
  expect(Object.fromEntries(Object.entries(kept.entries).map(([k, v]) => [k, dec(v)]))).toEqual({
    "docs/readme.md": "# Merhaba",
    "img/a/note.txt": "ğüşıöç",
    "top.txt": "top",
  });

  await page.getByText("Keep folder structure").click();
  await runAndWait(page);
  await expect(results).toContainText("in img/a");
  const flat = await downloadAll(page);
  expect(Object.keys(flat.entries).sort()).toEqual(["note.txt", "readme.md", "top.txt"]);
});

test("unzip refuses a zip bomb with a clear error", async ({ page }) => {
  // Patch the central directory so the entry claims ~4 GB unpacked.
  const zip = zipSync({ "big.bin": new Uint8Array(1000) });
  const view = new DataView(zip.buffer);
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 0xfffffff0, true);
      break;
    }
  }
  await openTool(page, "unzip");
  await uploadBuffer(page, "bomb.zip", zip);
  await page.getByTestId("run").click();
  await expect(page.getByTestId("queue")).toContainText("over the safety limit");
  await expect(page.getByTestId("results")).toHaveCount(0);
});

test("tar extractor opens a real .tar.gz with nested folders", async ({ page }) => {
  await openTool(page, "tar-extractor");
  await uploadFiles(page, ["archive-site.tar.gz"]);
  await runAndWait(page);
  const { name, entries } = await downloadAll(page);
  expect(name).toBe("archive-site.zip");
  expect(Object.keys(entries).sort()).toEqual(["site/assets/img/logo.png", "site/assets/style.css", "site/index.html"]);
  expect(dec(entries["site/index.html"])).toBe("<h1>Merhaba dünya</h1>\n");
  expect(Buffer.from(entries["site/assets/img/logo.png"])).toEqual(await readFile(fixture("logo.png")));
});

test("gzip compress → decompress round trip", async ({ page }) => {
  await openTool(page, "gzip-compress");
  await uploadFiles(page, ["data.csv", "notes.txt"]);
  await runAndWait(page);
  const { entries } = await downloadAll(page);
  expect(Object.keys(entries).sort()).toEqual(["data.csv.gz", "notes.txt.gz"]);
  expect(sniff(entries["data.csv.gz"])).toBe("gzip");
  expect(Buffer.from(gunzipSync(entries["data.csv.gz"]))).toEqual(await readFile(fixture("data.csv")));

  await openTool(page, "gzip-decompress");
  await uploadFiles(page, ["archive-notes.txt.gz"]);
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("archive-notes.txt");
  expect(Buffer.from(out.bytes)).toEqual(await readFile(fixture("notes.txt")));
});

test("gzip decompress restores the stored name for a bare .gz", async ({ page }) => {
  await openTool(page, "gzip-decompress");
  await uploadBuffer(page, "download.gz", gzipSync(enc("a,b\n1,2\n"), { filename: "report.csv" }));
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("report.csv");
  expect(dec(out.bytes)).toBe("a,b\n1,2\n");
});
