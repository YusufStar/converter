import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { loadPdf, splitPdf } from "../../lib/pdf/edit";
import { splitPlan, type SplitMode } from "../../lib/pdf/ranges";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, NumberField, Segmented } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { PDF_ACCEPT, RangeField, pagesLabel, pdfBlob, rangeOk, zipNameFor } from "./common";
import { s } from "./strings";

const HINT = { pages: "hintPages", ranges: "hintRanges", every: "hintEvery", extract: "hintExtract" } as const;

export default function SplitTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [mode, setMode] = useState<SplitMode>((meta.preset?.mode as SplitMode) ?? "pages");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState<number | null>(2);
  const n = queue.items.length;
  const needsRanges = mode === "ranges" || mode === "extract";
  const invalid = needsRanges ? !rangeOk(ranges) : mode === "every" ? !(every && every >= 1) : false;

  const run = () =>
    queue.runEach(async (file, ctx) => {
      const src = await loadPdf(await file.arrayBuffer());
      const plan = splitPlan(src.getPageCount(), mode, { ranges, every: every ?? 0 });
      const { base } = splitName(file.name);
      const parts = await splitPdf(src, plan, ctx.progress);
      // sourceSize undefined: a "−80%" badge per part would be noise.
      return parts.map((p) => ({ name: `${base}-${p.suffix}.pdf`, blob: pdfBlob(p.bytes), note: pagesLabel(t, p.pages), sourceSize: undefined }));
    });

  const label = mode === "extract" ? t("extractRun") : n > 1 ? t("splitRunN", { n }) : t("splitRun");

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          <Field label={t("splitMode")} hint={t(HINT[mode])}>
            <Segmented<SplitMode>
              label={t("splitMode")}
              value={mode}
              onChange={setMode}
              columns={2}
              size="sm"
              options={[
                { value: "pages", label: t("modePages") },
                { value: "ranges", label: t("modeRanges") },
                { value: "every", label: t("modeEvery") },
                { value: "extract", label: t("modeExtract") },
              ]}
            />
          </Field>
          {needsRanges ? <RangeField label={mode === "extract" ? t("pages") : t("ranges")} value={ranges} onChange={setRanges} /> : null}
          {mode === "every" ? <NumberField label={t("pagesPerFile")} value={every} onChange={setEvery} min={1} step={1} /> : null}
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={label} disabled={invalid} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
