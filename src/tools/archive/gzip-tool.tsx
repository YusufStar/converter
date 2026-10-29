import { useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { gunzipBytes, gunzipName, gzipBytes } from "../../lib/archive/archive";
import { useT } from "../../lib/i18n";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

type Level = 1 | 6 | 9;

export default function GzipTool({ meta }: EngineProps) {
  const t = useT(s);
  const decompress = (meta.preset as { mode?: string } | undefined)?.mode === "decompress";
  const queue = useQueue();
  const [level, setLevel] = useState<Level>(9);

  const run = () =>
    queue.runEach(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (decompress) return { name: gunzipName(file.name, bytes), blob: new Blob([(await gunzipBytes(bytes)) as BlobPart]) };
      const gz = await gzipBytes(bytes, { level, filename: file.name, mtime: new Date(file.lastModified) });
      return { name: `${file.name}.gz`, blob: new Blob([gz as BlobPart], { type: "application/gzip" }) };
    }, 2);

  const n = queue.items.length;
  const label = decompress ? (n > 1 ? t("decompressN", { n }) : t("decompress")) : n > 1 ? t("compressN", { n }) : t("compress");
  return (
    <ToolLayout
      meta={meta}
      input={decompress ? <FileInput queue={queue} accept=".gz,.tgz,.gzip" formats="GZ, TGZ" /> : <FileInput queue={queue} />}
      settings={
        <>
          {decompress ? null : (
            <Field label={t("level")} hint={level === 1 ? t("fastHint") : level === 9 ? t("maxHint") : undefined}>
              <Segmented<Level>
                label={t("level")}
                value={level}
                onChange={setLevel}
                columns={3}
                size="sm"
                options={[
                  { value: 1, label: t("fast") },
                  { value: 6, label: t("balanced") },
                  { value: 9, label: t("max") },
                ]}
              />
            </Field>
          )}
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{decompress ? t("gunzipHint") : t("gzipHint")}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={label} />}
      results={<Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
