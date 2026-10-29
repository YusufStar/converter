import { expect } from "@playwright/test";
import { downloadOne, imageSize, openTool, runAndWait, sniff, trackErrors, uploadFiles, test } from "./helpers";

test("home lists converters and sidebar navigates", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "WebP Converter" }).click();
  await expect(page).toHaveURL(/\/webp-converter$/);
  await expect(page.getByRole("heading", { level: 1, name: "WebP Converter" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("jpg → webp single file downloads in one click", async ({ page }) => {
  await openTool(page, "webp-converter");
  await uploadFiles(page, ["photo.jpg"]);
  await runAndWait(page);
  const out = await downloadOne(page);
  expect(out.name).toBe("photo.webp");
  expect(sniff(out.bytes)).toBe("webp");
  expect(imageSize(out.bytes)).toEqual({ width: 640, height: 480 });
});
