import { useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { removePages, rotatePdf } from "../../lib/pdf/edit";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, PageScope, RangeField, pagesLabel, pdfBlob, rangeOk, scopeInvalid, scopeRanges, zipNameFor, type Scope } from "./common";
import { s } from "./strings";

/** Rotate pages or remove pages, batch. `preset.op` picks which. */
export default function PagesTool({ meta }: EngineProps) {
  const t = useT(s);
  const op = meta.preset?.op === "remove" ? "remove" : "rotate";
  const queue = useQueue();
  const [angle, setAngle] = useState(90);
  const [scope, setScope] = useState<Scope>({ all: true, ranges: "" });
  const [remove, setRemove] = useState("");
  const n = queue.items.length;

  const run = () =>
    queue.runEach(async (file) => {
      const { base } = splitName(file.name);
      const input = await file.arrayBuffer();
      if (op === "rotate") return { name: `${base}-rotated.pdf`, blob: pdfBlob(await rotatePdf(input, angle, scopeRanges(scope))) };
      const out = await removePages(input, remove);
      return { name: `${base}-pages-removed.pdf`, blob: pdfBlob(out.bytes), note: pagesLabel(t, out.pages) };
    }, 3);

  const settings =
    op === "rotate" ? (
      <>
        <Field label={t("rotation")}>
          <Segmented
            label={t("rotation")}
            value={angle}
            onChange={setAngle}
            columns={3}
            options={[
              {
                value: 90,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <RotateCw className="size-3.5" />
                    {t("right90")}
                  </span>
                ),
              },
              { value: 180, label: t("turn180") },
              {
                value: 270,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <RotateCcw className="size-3.5" />
                    {t("left90")}
                  </span>
                ),
              },
            ]}
          />
        </Field>
        <PageScope value={scope} onChange={setScope} />
        <Hint>{t("rotateHint")}</Hint>
      </>
    ) : (
      <>
        <RangeField label={t("removeLabel")} value={remove} onChange={setRemove} />
        {n > 1 ? <Hint>{t("removeHint")}</Hint> : null}
      </>
    );

  const label = op === "rotate" ? (n > 1 ? t("rotateRunN", { n }) : t("rotateRun")) : n > 1 ? t("removeRunN", { n }) : t("removeRun");
  const invalid = op === "rotate" ? scopeInvalid(scope) : !rangeOk(remove);

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={settings}
      action={<RunButton queue={queue} onRun={run} label={label} disabled={invalid} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
