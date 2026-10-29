import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { downloadOne, fixture, openTool, runAndWait, trackErrors, uploadFiles } from "./helpers";

// Fixtures: pdf-extra-form.pdf = every AcroForm field type (page 1) + "city" (page 2);
// pdf-extra-sign.pdf = A4 page + landscape page with an offset crop box and /Rotate 90;
// pdf-extra-locked.pdf = sample.pdf, AES-256, open password "open-sesame";
// pdf-extra-restricted.pdf = sample.pdf, no open password, owner password, printing/copying off;
// pdf-extra-signature.png = dark stroke on grey "paper".

/** DejaVu Sans ascent and line height in em (see src/lib/pdf-extra/sign.ts). */
const ASCENT = 1901 / 2048;
const LINE = (1901 + 483) / 2048;

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** Opens with pdf.js; resolves to the error name when it can't. */
async function open(bytes: Uint8Array, password?: string) {
  const lib = await pdfjs();
  try {
    const doc = await lib.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
    const texts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      texts.push((await page.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return { pages: doc.numPages, texts, permissions: await doc.getPermissions() };
  } catch (e) {
    return (e as Error).name;
  }
}

type M = number[];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Images and text of one page as fractions of the page pdf.js shows (top-left origin). */
async function layout(bytes: Uint8Array, pageNo: number) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const frac = (x: number, y: number) => {
    const [vx, vy] = vp.convertToViewportPoint(x, y);
    return [vx / vp.width, vy / vp.height];
  };
  const ops = await page.getOperatorList();
  const images: { x: number; y: number; w: number; h: number }[] = [];
  const stack: M[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  ops.fnArray.forEach((fn, i) => {
    if (fn === lib.OPS.save) stack.push(ctm);
    else if (fn === lib.OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === lib.OPS.transform) ctm = mul(Array.from(ops.argsArray[i] as number[]), ctm);
    else if (fn === lib.OPS.paintImageXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => frac(ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      images.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
  });
  const text = (await page.getTextContent()).items.flatMap((it) => ("str" in it && it.str.trim() ? [{ str: it.str, at: frac(it.transform[4], it.transform[5]) }] : []));
  return { images, text };
}

/** A placement's box as fractions of its page, read from the DOM. */
async function placementBox(page: Page, pageNo: number, index = 0) {
  return page.evaluate(
    ([n, i]) => {
      const sheet = document.querySelector(`[data-testid=sign-page][data-page="${n}"]`)!;
      const p = sheet.getBoundingClientRect();
      const r = sheet.querySelectorAll("[data-testid=placement]")[i].getBoundingClientRect();
      return { x: (r.left - p.left) / p.width, y: (r.top - p.top) / p.height, w: r.width / p.width, h: r.height / p.height };
    },
    [pageNo, index] as const,
  );
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test.describe("protect-pdf", () => {
  test("AES-256 output needs the password in pdf.js and opens with it, permissions applied", async ({ page }) => {
    const errors = trackErrors(page);
    await openTool(page, "protect-pdf");
    await uploadFiles(page, ["sample.pdf"]);
    await expect(page.getByTestId("run")).toBeDisabled();
    await page.getByTestId("password").fill("şifre-123");
    await page.getByRole("switch", { name: "Print" }).uncheck();
    await page.getByRole("switch", { name: "Copy text and images" }).uncheck();
    await runAndWait(page);
    const out = await downloadOne(page);
    expect(out.name).toBe("sample-protected.pdf");
    expect(new TextDecoder("latin1").decode(out.bytes)).toMatch(/\/V 5|\/V\s*5/); // AES-256 (V5/R6)
    expect(await open(out.bytes)).toBe("PasswordException");
    expect(await open(out.bytes, "wrong")).toBe("PasswordException");
    const opened = await open(out.bytes, "şifre-123");
    expect(opened).toMatchObject({ pages: 3, texts: ["Page 1 of the sample document", "Page 2 of the sample document", "Page 3 of the sample document"] });
    // pdf.js lists what's allowed: print (4) and copy (16) are gone.
    const perms = typeof opened === "string" ? [] : [...(opened.permissions ?? [])];
    expect(perms).not.toContain(4);
    expect(perms).not.toContain(16);
    expect(perms).toContain(8);
    expect(errors).toEqual([]);
  });

  test("an already protected PDF says so", async ({ page }) => {
    await openTool(page, "protect-pdf");
    await uploadFiles(page, ["pdf-extra-locked.pdf"]);
    await page.getByTestId("password").fill("x");
    await page.getByTestId("run").click();
    await expect(page.getByTestId("queue")).toContainText("This PDF already has a password");
  });
});

test.describe("unlock-pdf", () => {
  test("wrong password → clear error, retry without re-uploading → opens without a password", async ({ page }) => {
    const errors = trackErrors(page);
    await openTool(page, "unlock-pdf");
    await uploadFiles(page, ["pdf-extra-locked.pdf"]);
    await expect(page.getByTestId("unlock-status")).toContainText("Needs a password to open");
    await expect(page.getByTestId("run")).toBeDisabled();
    await page.getByTestId("password").fill("not-it");
    await page.getByTestId("run").click();
    await expect(page.getByRole("alert").filter({ hasText: "Wrong password" })).toBeVisible();
    await expect(page.getByTestId("queue").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("results")).toHaveCount(0);
    await expect(page.getByTestId("password")).toBeFocused();

    await page.getByTestId("password").fill("open-sesame");
    await expect(page.getByRole("alert").filter({ hasText: "Wrong password" })).toHaveCount(0);
    await runAndWait(page);
    const out = await downloadOne(page);
    expect(out.name).toBe("pdf-extra-locked-unlocked.pdf");
    expect(new TextDecoder("latin1").decode(out.bytes)).not.toContain("/Encrypt");
    expect(await open(out.bytes)).toMatchObject({ pages: 3, texts: ["Page 1 of the sample document", "Page 2 of the sample document", "Page 3 of the sample document"] });
    expect(errors).toEqual([]);
  });

  test("restrictions-only PDF: no password asked, restrictions removed", async ({ page }) => {
    await openTool(page, "unlock-pdf");
    await uploadFiles(page, ["pdf-extra-restricted.pdf"]);
    await expect(page.getByTestId("unlock-status")).toContainText("Opens without a password");
    await expect(page.getByTestId("password")).toHaveCount(0);
    await runAndWait(page);
    const out = await downloadOne(page);
    const opened = await open(out.bytes);
    expect(opened).toMatchObject({ pages: 3, permissions: null });
  });

  test("a PDF without protection is reported, not copied", async ({ page }) => {
    await openTool(page, "unlock-pdf");
    await uploadFiles(page, ["sample.pdf"]);
    await expect(page.getByTestId("unlock-status")).toContainText("Not protected");
    await page.getByTestId("run").click();
    await expect(page.getByTestId("queue")).toContainText("This PDF has no password or restrictions");
  });
});

test.describe("fill-pdf-form", () => {
  test("fills every field type with Turkish text and flattens", async ({ page }) => {
    const errors = trackErrors(page);
    await openTool(page, "fill-pdf-form");
    await uploadFiles(page, ["pdf-extra-form.pdf"]);
    const form = page.getByTestId("form-fields");
    await expect(form.locator("[data-field]")).toHaveCount(9);
    await expect(form.locator('input[data-field="name"]')).toHaveValue("Ayse");
    await expect(form.locator('input[data-field="reference"]')).toBeDisabled();
    await expect(form.getByText("Anything else?")).toBeVisible();
    await expect(form.locator('[data-field="signature"]')).toContainText("Not signed");
    await expect(form.getByText("Page 2")).toBeVisible();

    await form.locator('input[data-field="name"]').fill("Ayşe Yılmaz");
    await form.locator('textarea[data-field="notes"]').fill("İkinci satır: ğüşöç");
    await form.locator('[data-field="agree"]').getByRole("switch").check();
    await form.locator('[data-field="plan"]').getByRole("radio", { name: "team" }).click();
    await form.locator('[data-field="country"]').getByRole("button", { name: "Turkey" }).click();
    await form.locator('[data-field="languages"]').getByRole("button", { name: "Turkish" }).click();
    await form.locator('input[data-field="city"]').fill("İstanbul");

    // Not flattened: real field values.
    await runAndWait(page);
    let out = await downloadOne(page);
    expect(out.name).toBe("pdf-extra-form-filled.pdf");
    const doc = await PDFDocument.load(out.bytes);
    const f = doc.getForm();
    expect(f.getTextField("name").getText()).toBe("Ayşe Yılmaz");
    expect(f.getCheckBox("agree").isChecked()).toBe(true);
    expect(f.getRadioGroup("plan").getSelected()).toBe("team");
    expect(f.getDropdown("country").getSelected()).toEqual(["Turkey"]);
    expect(f.getOptionList("languages").getSelected()).toEqual(["English", "Turkish"]);
    expect(f.getTextField("reference").getText()).toBe("REF-001");

    // Flattened: no fields left, the Turkish answers are page text pdf.js can read.
    await page.getByRole("switch", { name: "Flatten form" }).check();
    await runAndWait(page);
    out = await downloadOne(page);
    expect((await PDFDocument.load(out.bytes)).getForm().getFields()).toHaveLength(0);
    const opened = await open(out.bytes);
    if (typeof opened === "string") throw new Error(opened);
    expect(opened.texts[0]).toContain("Ayşe Yılmaz");
    expect(opened.texts[0]).toContain("İkinci satır: ğüşöç");
    expect(opened.texts[1]).toContain("İstanbul");
    expect(errors).toEqual([]);
  });

  test("a PDF without fields points to Sign PDF; a locked one to Unlock PDF", async ({ page }) => {
    await openTool(page, "fill-pdf-form");
    await uploadFiles(page, ["sample.pdf"]);
    await expect(page.getByTestId("no-form")).toContainText("no fillable form fields");
    await expect(page.getByTestId("run")).toBeDisabled();
    await uploadFiles(page, ["pdf-extra-locked.pdf"]); // one-file tool: replaces the PDF
    await expect(page.getByRole("alert")).toContainText("This PDF is password-protected");
    await page.getByRole("link", { name: "Unlock it first" }).click();
    await expect(page).toHaveURL(/\/unlock-pdf$/);
    await page.goBack();
    await uploadFiles(page, ["sample.pdf"]);
    await page.getByTestId("no-form").getByRole("link", { name: "Open Sign PDF" }).click();
    await expect(page).toHaveURL(/\/sign-pdf$/);
  });
});

test.describe("sign-pdf", () => {
  async function drawSignature(page: Page) {
    const pad = page.getByTestId("signature-pad");
    const box = (await pad.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.15 + i * 0.05), box.y + box.height * (0.6 - Math.sin(i / 2) * 0.25));
    await page.mouse.up();
  }

  test("draw, place, drag and date-stamp a rotated page; output matches the preview", async ({ page }) => {
    const errors = trackErrors(page);
    await openTool(page, "sign-pdf");
    await uploadFiles(page, ["pdf-extra-sign.pdf"]);
    await expect(page.getByTestId("sign-page")).toHaveCount(2);
    await expect(page.getByTestId("run")).toBeDisabled();

    // Draw a signature and place it on page 1.
    await page.getByTestId("sign-tools").getByRole("button", { name: "Signature", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("use-signature")).toBeDisabled();
    await drawSignature(page);
    await dialog.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("use-signature")).toBeDisabled();
    await drawSignature(page);
    await page.getByTestId("use-signature").click();
    await expect(dialog).toBeHidden();
    const page1 = page.locator('[data-testid=sign-page][data-page="1"]');
    const p1 = (await page1.boundingBox())!;
    await page1.click({ position: { x: p1.width * 0.5, y: p1.height * 0.7 } });
    await expect(page1.getByTestId("placement")).toHaveCount(1);

    // Drag it left and up, then grow it from the corner.
    const item = page1.getByTestId("placement");
    const ib = (await item.boundingBox())!;
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.mouse.down();
    await page.mouse.move(ib.x + ib.width / 2 - 60, ib.y + ib.height / 2 - 40, { steps: 5 });
    await page.mouse.up();
    const handle = page1.getByTestId("resize-handle");
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 40, hb.y + 15, { steps: 5 });
    await page.mouse.up();
    const sigBox = await placementBox(page, 1);
    expect(sigBox.x).toBeLessThan(0.5 - sigBox.w / 2);

    // Date stamp on the rotated page 2, edited to custom text.
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByTestId("sign-tools").getByRole("button", { name: "Date", exact: true }).click();
    const page2 = page.locator('[data-testid=sign-page][data-page="2"]');
    await page2.scrollIntoViewIfNeeded();
    const p2 = (await page2.boundingBox())!;
    await page2.click({ position: { x: p2.width * 0.4, y: p2.height * 0.3 } });
    await expect(page.getByTestId("item-text")).toBeFocused();
    await page.getByTestId("item-text").fill("Signed İstanbul 2026");
    const textBox = await placementBox(page, 2);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("placed-count")).toHaveText("2 placed");

    await runAndWait(page);
    const out = await downloadOne(page);
    expect(out.name).toBe("pdf-extra-sign-signed.pdf");

    const l1 = await layout(out.bytes, 1);
    expect(l1.images).toHaveLength(1);
    for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(l1.images[0][k] - sigBox[k])).toBeLessThan(0.004);

    const l2 = await layout(out.bytes, 2);
    const stamp = l2.text.find((t) => t.str.includes("İstanbul"));
    expect(stamp?.str).toBe("Signed İstanbul 2026");
    // Baseline = box top + one ascent of a font whose line box is the placement height.
    expect(Math.abs(stamp!.at[0] - textBox.x)).toBeLessThan(0.004);
    expect(Math.abs(stamp!.at[1] - (textBox.y + (ASCENT * textBox.h) / LINE))).toBeLessThan(0.004);
    expect(errors).toEqual([]);
  });

  test("typed signature, uploaded image without its paper, saved for next time, on every page", async ({ page }) => {
    await openTool(page, "sign-pdf");
    await uploadFiles(page, ["pdf-extra-sign.pdf"]);
    await expect(page.getByTestId("sign-page")).toHaveCount(2);

    // Typed signature.
    await page.getByTestId("sign-tools").getByRole("button", { name: "Signature", exact: true }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "Type" }).click();
    await page.getByTestId("typed-name").fill("Ada Lovelace");
    await page.getByRole("dialog").getByRole("radio", { name: "Style 3" }).click();
    await page.getByTestId("use-signature").click();
    const page1 = page.locator('[data-testid=sign-page][data-page="1"]');
    await page1.click({ position: { x: 200, y: 300 } });
    await page.getByRole("button", { name: "Done" }).click();

    // Initials from an uploaded photo; the typed name prefilled them and the signature was saved.
    await page.getByTestId("sign-tools").getByRole("button", { name: "Initials", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: /Saved · 1/ })).toBeVisible();
    await dialog.getByRole("radio", { name: "Type" }).click();
    await expect(page.getByTestId("typed-name")).toHaveValue("AL");
    await dialog.getByRole("radio", { name: "Upload" }).click();
    await page.getByTestId("signature-upload").setInputFiles(fixture("pdf-extra-signature.png"));
    await expect(page.getByTestId("upload-preview")).toBeVisible();
    await page.getByTestId("use-signature").click();
    await page1.click({ position: { x: 80, y: 60 } });
    await page.getByTestId("to-all-pages").click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator('[data-testid=sign-page][data-page="2"]').getByTestId("placement")).toHaveCount(1);
    await expect(page.getByTestId("placed-count")).toHaveText("3 placed");

    await runAndWait(page);
    const out = await downloadOne(page);
    expect((await layout(out.bytes, 1)).images).toHaveLength(2);
    expect((await layout(out.bytes, 2)).images).toHaveLength(1);

    // The uploaded image keeps an alpha mask with the paper cleared.
    const doc = await PDFDocument.load(out.bytes);
    const masks = doc.context
      .enumerateIndirectObjects()
      .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of("SMask")) ? [doc.context.lookup(o.dict.get(PDFName.of("SMask"))) as PDFRawStream] : []));
    expect(masks.length).toBe(2);
    const alphas = masks.map((m) => decodePDFRawStream(m).decode());
    for (const a of alphas) {
      const clear = a.filter((v) => v === 0).length / a.length;
      expect(clear).toBeGreaterThan(0.3);
      expect(a.some((v) => v === 255)).toBe(true);
    }
  });

  test("password-protected PDF links to Unlock PDF; phone width has no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTool(page, "sign-pdf");
    await uploadFiles(page, ["pdf-extra-locked.pdf"]);
    await expect(page.getByRole("alert")).toContainText("This PDF is password-protected");
    await expect(page.getByRole("link", { name: "Unlock it first" })).toBeVisible();
    // Opens in pdf.js but can't be saved by pdf-lib: flagged on load, not after signing.
    await uploadFiles(page, ["pdf-extra-restricted.pdf"]);
    await expect(page.getByRole("link", { name: "Unlock it first" })).toBeVisible();
    await expect(page.getByTestId("sign-page")).toHaveCount(0);
    await uploadFiles(page, ["pdf-extra-sign.pdf"]);
    await page.getByTestId("sign-tools").getByRole("button", { name: "Signature", exact: true }).click();
    await drawSignature(page);
    await noHorizontalScroll(page);
    await page.getByTestId("use-signature").click();
    await page.locator('[data-testid=sign-page][data-page="1"]').click({ position: { x: 150, y: 200 } });
    await expect(page.getByTestId("placement")).toHaveCount(1);
    await noHorizontalScroll(page);
    for (const slug of ["fill-pdf-form", "protect-pdf", "unlock-pdf"]) {
      await openTool(page, slug);
      await noHorizontalScroll(page);
    }
  });
});
