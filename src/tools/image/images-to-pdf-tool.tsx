import { useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { prepareForPdf } from "../../lib/image/convert";
import { IMAGE_ACCEPT, IMAGE_FORMATS_LABEL } from "../../lib/image/formats";
import { DEFAULT_RESIZE } from "../../lib/image/resize";
import { DEFAULT_LAYOUT, imagesToPdf, type ImageFit, type Orientation, type PageSizeId, type PdfLayoutOptions } from "../../lib/pdf/images-to-pdf";
import { mapPool } from "../../lib/pool";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

type Quality = "original" | 90 | 75 | 55;
const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: "application/pdf" });

export default function ImagesToPdfTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [mode, setMode] = useState<"one" | "each">("one");
  const [layout, setLayout] = useState<PdfLayoutOptions>(DEFAULT_LAYOUT);
  const [quality, setQuality] = useState<Quality>("original");
  const [shrink, setShrink] = useState(false);
  const set = (p: Partial<PdfLayoutOptions>) => setLayout((l) => ({ ...l, ...p }));

  const resize = shrink ? { ...DEFAULT_RESIZE, mode: "longest" as const, longest: 2000, noEnlarge: true } : DEFAULT_RESIZE;

  const run = () => {
    if (mode === "each") {
      return queue.runEach(async (file) => {
        const img = await prepareForPdf(file, quality, resize);
        return { name: `${splitName(file.name).base}.pdf`, blob: pdfBlob(await imagesToPdf([img], layout)), note: t("pages", { n: 1 }) };
      }, 3);
    }
    return queue.runAll(async (files, ctx) => {
      // Decode/re-encode in parallel, then write pages in list order.
      let done = 0;
      const images = await mapPool(files, 3, async (f) => {
        if (ctx.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const img = await prepareForPdf(f, quality, resize);
        ctx.progress((++done / files.length) * 0.8);
        return img;
      });
      const bytes = await imagesToPdf(images, layout, (p) => ctx.progress(0.8 + p * 0.2));
      const first = splitName(files[0].name).base;
      const name = files.length === 1 ? `${first}.pdf` : "images.pdf";
      return [{ name, blob: pdfBlob(bytes), note: t("pages", { n: files.length }) }];
    });
  };

  const n = queue.items.length;
  const fixedPage = layout.pageSize !== "fit";

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={IMAGE_ACCEPT} formats={IMAGE_FORMATS_LABEL} reorderable />}
      settings={
        <>
          <Field label={t("pdfMode")}>
            <Segmented
              label={t("pdfMode")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "one", label: t("pdfOne") },
                { value: "each", label: t("pdfEach") },
              ]}
            />
          </Field>
          <Field label={t("pageSize")}>
            <Segmented<PageSizeId>
              label={t("pageSize")}
              value={layout.pageSize}
              onChange={(pageSize) => set({ pageSize })}
              columns={3}
              size="sm"
              options={[
                { value: "a4", label: "A4" },
                { value: "letter", label: "Letter" },
                { value: "fit", label: t("pageFit") },
                { value: "a3", label: "A3" },
                { value: "a5", label: "A5" },
                { value: "legal", label: "Legal" },
              ]}
            />
          </Field>
          {fixedPage ? (
            <>
              <Field label={t("orientation")}>
                <Segmented<Orientation>
                  label={t("orientation")}
                  value={layout.orientation}
                  onChange={(orientation) => set({ orientation })}
                  size="sm"
                  options={[
                    { value: "auto", label: t("auto") },
                    { value: "portrait", label: t("portrait") },
                    { value: "landscape", label: t("landscape") },
                  ]}
                />
              </Field>
              <Field label={t("fit")}>
                <Segmented<ImageFit>
                  label={t("fit")}
                  value={layout.fit}
                  onChange={(fit) => set({ fit })}
                  size="sm"
                  options={[
                    { value: "contain", label: t("contain") },
                    { value: "cover", label: t("cover") },
                    { value: "stretch", label: t("stretch") },
                  ]}
                />
              </Field>
            </>
          ) : null}
          <Field label={t("margin")}>
            <Segmented<number>
              label={t("margin")}
              value={layout.margin}
              onChange={(margin) => set({ margin })}
              size="sm"
              options={[
                { value: 0, label: t("none") },
                { value: 18, label: t("small") },
                { value: 40, label: t("large") },
              ]}
            />
          </Field>
          <Field label={t("imageQuality")} hint={quality === "original" ? t("qOriginalHint") : undefined}>
            <Segmented<Quality>
              label={t("imageQuality")}
              value={quality}
              onChange={setQuality}
              columns={4}
              size="sm"
              options={[
                { value: "original", label: t("qOriginal") },
                { value: 90, label: t("qHigh") },
                { value: 75, label: t("qMedium") },
                { value: 55, label: t("qLow") },
              ]}
            />
          </Field>
          <Switch checked={shrink} onChange={setShrink} label={t("shrink")} hint={t("shrinkHint")} />
          {mode === "one" ? (
            <p className="flex gap-2 text-xs leading-relaxed text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t("pdfOrder")}
            </p>
          ) : null}
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={mode === "one" ? t("makePdf") : t("makePdfs", { n })} />}
      results={<Results outputs={queue.outputs} zipName="images-pdf.zip" />}
    />
  );
}
