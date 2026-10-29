import { useState } from "react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { mergePdfs } from "../../lib/pdf/edit";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pagesLabel, pdfBlob } from "./common";
import { s } from "./strings";

export default function MergeTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [name, setName] = useState("merged");
  const n = queue.items.length;

  const run = () =>
    queue.runAll(async (files, ctx) => {
      const { bytes, pages } = await mergePdfs(await Promise.all(files.map((f) => f.arrayBuffer())), ctx.progress);
      const base = name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "merged";
      return [{ name: `${base}.pdf`, blob: pdfBlob(bytes), note: pagesLabel(t, pages) }];
    });

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" reorderable />}
      settings={
        <>
          <TextField label={t("fileName")} value={name} onChange={(e) => setName(e.target.value)} placeholder="merged" spellCheck={false} />
          <Hint>{t("mergeOrder")}</Hint>
          <Hint>{t("mergeNote")}</Hint>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n >= 2 ? t("mergeN", { n }) : t("mergeNeedTwo")} disabled={n < 2} />}
      results={<Results outputs={queue.outputs} />}
    />
  );
}
