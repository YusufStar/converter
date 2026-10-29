import { expect, test } from "@playwright/test";
import { downloadOne, fixture, openTool, runAndWait, sniff, trackErrors, uploadFiles } from "./helpers";
import { readFile } from "node:fs/promises";

const sidebar = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "All converters" });

test("format pair page converts with its preset and links its family", async ({ page }) => {
  const errors = trackErrors(page);
  await openTool(page, "png-to-jpg");
  await expect(page.getByRole("heading", { level: 1, name: "PNG to JPG" })).toBeVisible();
  // Preset pages stay out of the sidebar but link to their parent and siblings.
  await expect(sidebar(page).getByRole("link", { name: "PNG to JPG" })).toHaveCount(0);
  const related = page.getByRole("navigation", { name: "Related conversions" });
  await expect(related.getByRole("link", { name: "JPG Converter" })).toBeVisible();
  await expect(related.getByRole("link", { name: "WebP to JPG" })).toBeVisible();

  await uploadFiles(page, ["logo.png"]);
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("logo.jpg");
  expect(sniff(out.bytes)).toBe("jpg");
  expect(errors).toEqual([]);
});

test("parent tool lists its X-to-Y pages; search finds them", async ({ page }) => {
  await openTool(page, "jpg-converter");
  await expect(page.getByRole("navigation", { name: "Related conversions" }).getByRole("link", { name: "PNG to JPG" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search converters…" }).first().fill("heic to png");
  await expect(sidebar(page).getByRole("link", { name: "HEIC to PNG" })).toBeVisible();
});

test("continue with another tool hands the results over", async ({ page }) => {
  await openTool(page, "png-to-jpg");
  await uploadFiles(page, ["logo.png"]);
  await runAndWait(page);
  await page.getByTestId("continue-with").click();
  await page.getByRole("button", { name: "Image Compressor" }).click();
  await expect(page).toHaveURL(/\/image-compressor$/);
  await expect(page.getByTestId("queue").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("queue")).toContainText("logo.jpg");
});

test("home: drop any file to see which tools take it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("home-file-input").setInputFiles(fixture("sample.pdf"));
  const results = page.getByTestId("home-drop-results");
  await expect(results).toContainText("sample.pdf");
  await expect(results.getByRole("link", { name: /Merge PDF/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /PDF to JPG/ })).toBeVisible();
  // Image tools don't take PDFs.
  await expect(results.getByRole("link", { name: /WebP Converter/ })).toHaveCount(0);
  await results.getByRole("link", { name: /Merge PDF/ }).click();
  await expect(page).toHaveURL(/\/merge-pdf$/);
  await expect(page.getByTestId("queue")).toContainText("sample.pdf");
});

test("favorites persist and recent tools show on the home page", async ({ page }) => {
  await openTool(page, "webp-converter");
  await page.getByTestId("favorite").click();
  await expect(page.getByTestId("favorite")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sidebar-favorites").getByRole("link", { name: "WebP Converter" })).toBeVisible();
  await openTool(page, "merge-pdf");
  await page.reload();
  await expect(page.getByTestId("sidebar-favorites").getByRole("link", { name: "WebP Converter" })).toBeVisible();
  await page.goto("/");
  const recent = page.getByTestId("recent-tools");
  await expect(recent.getByRole("link", { name: "Merge PDF" })).toBeVisible();
  await expect(recent.getByRole("link").first()).toHaveText("Merge PDF");
});

test("dropping files on a tool's drop zone queues them", async ({ page }) => {
  await openTool(page, "image-converter");
  const bytes = [...(await readFile(fixture("logo.png")))];
  const dt = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], "dropped.png", { type: "image/png" }));
    return transfer;
  }, bytes);
  await page.getByRole("button", { name: /Drop files here/ }).dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByTestId("queue")).toContainText("dropped.png");
});

test("app is cross-origin isolated and ships a web app manifest", async ({ page, request }) => {
  await page.goto("/");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.short_name).toBe("Converter");
  expect(manifest.icons.length).toBeGreaterThan(2);
  const accepted = Object.values(manifest.file_handlers[0].accept as Record<string, string[]>).flat();
  expect(accepted).toEqual(expect.arrayContaining([".pdf", ".png", ".docx", ".mp4", ".csv"]));
});

test("language lives in the URL: /tr/… is Turkish, switching keeps the page", async ({ page }) => {
  await page.goto("/tr/webp-converter");
  await expect(page.getByRole("heading", { level: 1, name: "WebP Dönüştürücü" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  // Translated pages are for visitors only; search engines index the English ones.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  const trSidebar = page.getByRole("navigation", { name: "Tüm dönüştürücüler" });
  await expect(trSidebar.getByRole("link", { name: "PDF Birleştir" })).toHaveAttribute("href", "/tr/merge-pdf");

  await page.goto("/webp-converter");
  await expect(page.getByRole("heading", { level: 1, name: "WebP Converter" })).toBeVisible();
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("button", { name: "Türkçe" }).click();
  await expect(page).toHaveURL(/\/tr\/webp-converter$/);
  await expect(page.getByRole("heading", { level: 1, name: "WebP Dönüştürücü" })).toBeVisible();
  // The choice is remembered: an unprefixed link now lands on the Turkish page.
  await page.goto("/merge-pdf");
  await expect(page).toHaveURL(/\/tr\/merge-pdf$/);
  await page.getByRole("button", { name: "Dil" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page).toHaveURL(/\/merge-pdf$/);
  await expect(page.getByRole("heading", { level: 1, name: "Merge PDF" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/merge-pdf$/);
});

test("a password-protected PDF links to Unlock PDF with the file", async ({ page }) => {
  await openTool(page, "compress-pdf");
  await uploadFiles(page, ["pdf-extra-locked.pdf"]);
  await page.getByTestId("run").click();
  const link = page.getByTestId("queue").getByRole("link", { name: "Unlock it first →" });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await link.click();
  await expect(page).toHaveURL(/\/unlock-pdf$/);
  await expect(page.getByTestId("queue")).toContainText("pdf-extra-locked.pdf");
});

test("every language has its own URL, menu and translated tool pages", async ({ page }) => {
  const cases = [
    ["es", "Idioma", "Convertidor WebP"],
    ["de", "Sprache", "WebP-Konverter"],
    ["fr", "Langue", "Convertisseur WebP"],
    ["pt", "Idioma", "Conversor WebP"],
  ] as const;
  for (const [lang, menu, heading] of cases) {
    await page.goto(`/${lang}/webp-converter`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByRole("button", { name: menu })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  }
  await page.goto("/webp-converter");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page).toHaveURL(/\/de\/webp-converter$/);
  await page.getByRole("textbox", { name: /Konverter suchen|Suche/ }).first().fill("zusammenführen");
  await expect(page.getByRole("navigation").first().getByRole("link").filter({ hasText: /PDF/ }).first()).toBeVisible();
});

