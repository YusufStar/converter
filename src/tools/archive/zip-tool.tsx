import { useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { zipEntries } from "../../lib/archive/archive";
import { uniqueNames } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

type Level = 0 | 1 | 9;

export default function ZipTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [name, setName] = useState("archive");
  const [level, setLevel] = useState<Level>(9);

  const run = () =>
    queue.runAll(async (files, ctx) => {
      const names = uniqueNames(files.map((f) => f.name));
      const entries = [];
      for (let i = 0; i < files.length; i++) {
        entries.push({ name: names[i], data: new Uint8Array(await files[i].arrayBuffer()), mtime: new Date(files[i].lastModified) });
        ctx.progress(((i + 1) / files.length) * 0.4);
      }
      const bytes = await zipEntries(entries, level);
      const base = name.trim().replace(/\.zip$/i, "").replace(/[\\/:*?"<>|]/g, "_") || "archive";
      return [
        {
          name: `${base}.zip`,
          blob: new Blob([bytes as BlobPart], { type: "application/zip" }),
          sourceSize: files.reduce((a, f) => a + f.size, 0),
          note: t("filesNote", { n: files.length }),
        },
      ];
    });

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} />}
      settings={
        <>
          <TextField label={t("archiveName")} value={name} onChange={(e) => setName(e.target.value)} placeholder="archive" data-testid="archive-name" />
          <Field label={t("compression")} hint={level === 0 ? t("storeHint") : level === 1 ? t("fastHint") : t("maxHint")}>
            <Segmented<Level>
              label={t("compression")}
              value={level}
              onChange={setLevel}
              columns={3}
              size="sm"
              options={[
                { value: 0, label: t("store") },
                { value: 1, label: t("fast") },
                { value: 9, label: t("max") },
              ]}
            />
          </Field>
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("zipOrder")}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("createZipN", { n }) : t("createZip")} />}
      results={<Results outputs={queue.outputs} zipName={`${name || "archive"}.zip`} />}
    />
  );
}
