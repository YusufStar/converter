import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { canvasToBlob } from "../../lib/image/encode";
import { optimizePdf, pdfFromJpegs, type RasterPage } from "../../lib/pdf/edit";
import { closePdf, openFile, renderPage } from "../../lib/pdf/pdfjs";
import { useQueue, type RunContext } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pdfBlob, zipNameFor } from "./common";
import { s } from "./strings";

type Level = "lossless" | "balanced" | "strong";

const RASTER = { balanced: { dpi: 150, quality: 0.72 }, strong: { dpi: 110, quality: 0.5 } };
const HINT = { lossless: "losslessHint", balanced: "balancedHint", strong: "strongHint" } as const;

/** Re-renders every page to a JPEG and rebuilds the PDF at the original page sizes. */
async function rasterize(file: File, level: Exclude<Level, "lossless">, ctx: RunContext): Promise<Uint8Array> {
  const { dpi, quality } = RASTER[level];
  const doc = await openFile(file);
  try {
    const pages: RasterPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const size = page.getViewport({ scale: 1 }); // points, /Rotate applied
      const canvas = await renderPage(page, dpi / 72, { signal: ctx.signal });
      const jpg = new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", quality)).arrayBuffer());
      canvas.width = canvas.height = 0;
      page.cleanup();
      pages.push({ jpg, width: size.width, height: size.height });
      ctx.progress((i / doc.numPages) * 0.95);
    }
    return pdfFromJpegs(pages);
  } finally {
    await closePdf(doc);
  }
}

export default function CompressTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [level, setLevel] = useState<Level>("balanced");
  const n = queue.items.length;

  const run = () =>
    queue.runEach(
      async (file, ctx) => {
        const bytes = level === "lossless" ? await optimizePdf(await file.arrayBuffer()) : await rasterize(file, level, ctx);
        const name = `${splitName(file.name).base}-compressed.pdf`;
        // Never hand back a bigger file than the one we got.
        if (bytes.length >= file.size) return { name, blob: new Blob([file], { type: "application/pdf" }), note: t("keptOriginal") };
        return { name, blob: pdfBlob(bytes) };
      },
      level === "lossless" ? 2 : 1,
    );

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          <Field label={t("level")} hint={t(HINT[level])}>
            <Segmented<Level>
              label={t("level")}
              value={level}
              onChange={setLevel}
              columns={3}
              options={[
                { value: "lossless", label: t("lossless") },
                { value: "balanced", label: t("balanced") },
                { value: "strong", label: t("strong") },
              ]}
            />
          </Field>
          {level !== "lossless" ? <Hint tone="warn">{t("rasterWarn")}</Hint> : null}
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("compressRunN", { n }) : t("compressRun")} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
