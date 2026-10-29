import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { gunzipSync, gzipSync, unzipSync, zipSync } from "fflate";
import factory from "libarchive.js/src/webworker/wasm-gen/libarchive.js";
import { bindLibarchive } from "../src/lib/archive/libarchive-core";
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
  // The tree lists the files right away and hands out single files without extracting.
  const contents = page.getByTestId("archive-contents");
  await expect(contents).toContainText("3 files");
  // Top-level folders start open; "img/a" opens on click.
  await contents.getByRole("button", { name: /^a \d/ }).click();
  const [one] = await Promise.all([page.waitForEvent("download"), contents.getByRole("button", { name: "Download note.txt" }).click()]);
  expect(one.suggestedFilename()).toBe("note.txt");
  expect(dec(new Uint8Array(await readFile(await one.path())))).toBe("ğüşıöç");
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

// ---------- libarchive: 7Z, RAR, TAR.XZ / TAR.BZ2, passwords, 7Z creation ----------

const la = bindLibarchive(await factory({ print() {}, printErr() {} }));
const nfc = (entries: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k.normalize("NFC"), dec(v)]));

test("7z extractor lists the tree, downloads one file, then extracts all", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "7z-extractor");
  await uploadFiles(page, ["archive-sample.7z"]);
  const contents = page.getByTestId("archive-contents");
  await expect(contents).toContainText("2 files");
  await expect(contents.getByRole("treeitem", { name: /^readme\.md 10 B/ })).toBeVisible();

  const [single] = await Promise.all([page.waitForEvent("download"), contents.getByRole("button", { name: /^Download ğüşıöç\.txt$/ }).click()]);
  expect(single.suggestedFilename().normalize("NFC")).toBe("ğüşıöç.txt");
  expect(dec(new Uint8Array(await readFile(await single.path())))).toBe("Merhaba dünya\n");

  await runAndWait(page);
  const all = await downloadAll(page);
  expect(all.name).toBe("archive-sample.zip");
  expect(nfc(all.entries)).toEqual({ "docs/readme.md": "# Merhaba\n", "ğüşıöç.txt": "Merhaba dünya\n" });
  expect(errors).toEqual([]);
});

test("rar extractor opens RAR4 and RAR5", async ({ page }) => {
  await openTool(page, "rar-extractor");
  await uploadFiles(page, ["archive-libarchive-rar4.rar", "archive-libarchive-rar5.rar"]);
  await runAndWait(page);
  const { entries } = await downloadAll(page);
  expect(Object.keys(entries).sort()).toEqual(["archive-libarchive-rar4/test.txt", "archive-libarchive-rar4/testdir/test.txt", "archive-libarchive-rar5/test.bin"]);
  expect(dec(entries["archive-libarchive-rar4/testdir/test.txt"])).toBe("test text document\r\n");
  expect(entries["archive-libarchive-rar5/test.bin"].length).toBe(1200);
});

test("tar extractor opens .tar.xz and .tar.bz2", async ({ page }) => {
  await openTool(page, "tar-extractor");
  for (const name of ["archive-sample.tar.xz", "archive-sample.tar.bz2"]) {
    await uploadFiles(page, [name]);
    await runAndWait(page);
    const { entries } = await downloadAll(page);
    expect(nfc(entries)).toEqual({ "docs/readme.md": "# Merhaba\n", "ğüşıöç.txt": "Merhaba dünya\n" });
    await page.getByRole("button", { name: "Clear" }).click();
  }
});

test("password-protected zip: asks, rejects a wrong password, retries without re-uploading", async ({ page }) => {
  await openTool(page, "unzip");
  await uploadFiles(page, ["archive-locked.zip"]);
  const password = page.getByTestId("archive-password");
  await expect(password).toBeVisible();
  await page.getByTestId("run").click();
  await expect(page.getByTestId("queue")).toContainText("password-protected");

  await password.fill("nope");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("queue")).toContainText("Wrong password");

  await password.fill("gizli");
  await runAndWait(page);
  expect(nfc((await downloadAll(page)).entries)).toEqual({ "docs/readme.md": "# Merhaba\n", "ğüşıöç.txt": "Merhaba dünya\n" });
});

test("encrypted 7z explains that it can't be opened", async ({ page }) => {
  await openTool(page, "7z-extractor");
  await uploadFiles(page, ["archive-locked.7z"]);
  await page.getByTestId("archive-password").fill("gizli");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("queue")).toContainText("encrypted 7Z or RAR");
});

test("7z creator makes real .7z and .tar.xz archives", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "7z-creator");
  await uploadFiles(page, ["data.csv", "notes.txt"]);
  await page.getByTestId("archive-name").fill("paket");
  await runAndWait(page);
  const sz = await downloadOne(page);
  expect(sz.name).toBe("paket.7z");
  expect([...sz.bytes.subarray(0, 6)]).toEqual([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  const files = la.read(sz.bytes, { want: () => true });
  expect(files.map((f) => f.path)).toEqual(["data.csv", "notes.txt"]);
  expect(Buffer.from(files[0].data!)).toEqual(await readFile(fixture("data.csv")));

  await page.getByRole("radio", { name: "TAR.XZ" }).click();
  await runAndWait(page);
  const txz = await downloadOne(page);
  expect(txz.name).toBe("paket.tar.xz");
  expect(dec(txz.bytes.subarray(1, 5))).toBe("7zXZ");
  expect(la.read(txz.bytes, { want: () => true }).map((f) => f.path)).toEqual(["data.csv", "notes.txt"]);
  expect(errors).toEqual([]);
});
