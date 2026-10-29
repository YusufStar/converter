import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { encodeCanvas } from "../../lib/image/encode";
import { pageSelection } from "../../lib/pdf/ranges";
import { closePdf, openFile, renderPage } from "../../lib/pdf/pdfjs";
import { useQueue, type OutputInit } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, NumberField, Segmented, Slider, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { PDF_ACCEPT, PageScope, scopeInvalid, scopeRanges, zipNameFor, type Scope } from "./common";
import { s } from "./strings";

type Fmt = "jpg" | "png" | "webp";
type Dpi = 72 | 150 | 300 | "custom";
const LABEL: Record<Fmt, string> = { jpg: "JPG", png: "PNG", webp: "WEBP" };

export default function ImagesTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [fmt, setFmt] = useState<Fmt>((meta.preset?.format as Fmt) ?? "jpg");
  const [dpiChoice, setDpiChoice] = useState<Dpi>(150);
  const [customDpi, setCustomDpi] = useState<number | null>(200);
  const [quality, setQuality] = useState(85);
  const [transparent, setTransparent] = useState(false);
  const [scope, setScope] = useState<Scope>({ all: true, ranges: "" });
  const dpi = dpiChoice === "custom" ? Math.min(600, Math.max(36, customDpi ?? 150)) : dpiChoice;
  const lossy = fmt !== "png";
  const alpha = fmt !== "jpg" && transparent;

  const run = () =>
    queue.runEach(
      async (file, ctx) => {
        const doc = await openFile(file);
        try {
          const total = doc.numPages;
          const only = pageSelection(scopeRanges(scope), total);
          const list = only ? [...only].sort((a, b) => a - b) : [...Array(total).keys()];
          const pad = Math.max(2, String(total).length);
          const { base } = splitName(file.name);
          const out: OutputInit[] = [];
          for (const [k, i] of list.entries()) {
            const page = await doc.getPage(i + 1);
            const canvas = await renderPage(page, dpi / 72, { background: alpha ? "rgba(0,0,0,0)" : "#ffffff", signal: ctx.signal });
            const blob = await encodeCanvas(canvas, fmt, { quality, lossless: false, pngColors: 0, icoSizes: [] });
            const wanted = Math.round(page.getViewport({ scale: dpi / 72 }).width);
            out.push({
              name: `${base}-p${String(i + 1).padStart(pad, "0")}.${fmt}`,
              blob,
              width: canvas.width,
              height: canvas.height,
              note: canvas.width < wanted - 1 ? t("scaledDown") : undefined,
              sourceSize: undefined,
            });
            canvas.width = canvas.height = 0; // free the bitmap now, not at GC time
            page.cleanup();
            ctx.progress((k + 1) / list.length);
          }
          return out;
        } finally {
          await closePdf(doc);
        }
      },
      dpi > 200 ? 1 : 2,
    );

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          <Field label={t("format")}>
            <Segmented<Fmt> label={t("format")} value={fmt} onChange={setFmt} columns={3} options={(["jpg", "png", "webp"] as const).map((f) => ({ value: f, label: LABEL[f] }))} />
          </Field>
          <Field label={t("resolution")} hint={t("dpiHint")}>
            <Segmented<Dpi>
              label={t("resolution")}
              value={dpiChoice}
              onChange={setDpiChoice}
              columns={4}
              size="sm"
              options={[
                { value: 72, label: "72" },
                { value: 150, label: "150" },
                { value: 300, label: "300" },
                { value: "custom", label: t("custom") },
              ]}
            />
            {dpiChoice === "custom" ? <NumberField label="DPI" value={customDpi} onChange={setCustomDpi} min={36} max={600} step={1} suffix="DPI" /> : null}
          </Field>
          {lossy ? <Slider label={t("quality")} value={quality} onChange={setQuality} min={30} max={100} suffix="%" marks={[t("smaller"), t("better")]} /> : null}
          {fmt !== "jpg" ? <Switch checked={transparent} onChange={setTransparent} label={t("transparent")} hint={t("transparentHint")} /> : null}
          <PageScope value={scope} onChange={setScope} />
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={t("imagesRun", { format: LABEL[fmt] })} disabled={scopeInvalid(scope)} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
