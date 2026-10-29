import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { laWrite, warmUpLibarchive, type WriteKind } from "../../lib/archive/libarchive";
import { uniqueNames } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

const LABEL: Record<WriteKind, string> = { "7z": "7Z", "tar.xz": "TAR.XZ", "tar.bz2": "TAR.BZ2" };
const MIME: Record<WriteKind, string> = { "7z": "application/x-7z-compressed", "tar.xz": "application/x-xz", "tar.bz2": "application/x-bzip2" };

export default function CreateTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [name, setName] = useState("archive");
  const [kind, setKind] = useState<WriteKind>(((meta.preset as { kind?: WriteKind } | undefined)?.kind) ?? "7z");

  useEffect(() => warmUpLibarchive(), []);

  const run = () =>
    queue.runAll(async (files, ctx) => {
      const names = uniqueNames(files.map((f) => f.name));
      const entries = await Promise.all(files.map(async (f, i) => ({ path: names[i], data: new Uint8Array(await f.arrayBuffer()) })));
      ctx.progress(0.2);
      const bytes = await laWrite(entries, kind, ctx.signal);
      const base = name.trim().replace(/\.(7z|tar\.xz|tar\.bz2|txz|tbz2?)$/i, "").replace(/[\\/:*?"<>|]/g, "_") || "archive";
      return [
        {
          name: `${base}.${kind}`,
          blob: new Blob([bytes as BlobPart], { type: MIME[kind] }),
          sourceSize: files.reduce((a, f) => a + f.size, 0),
          note: t("filesNote", { n: files.length }),
        },
      ];
    });

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} />}
      settings={
        <>
          <TextField label={t("archiveName")} value={name} onChange={(e) => setName(e.target.value)} placeholder="archive" data-testid="archive-name" />
          <Field label={t("format")} hint={kind === "7z" ? t("sevenZipHint") : kind === "tar.xz" ? t("txzHint") : t("tbzHint")}>
            <Segmented<WriteKind>
              label={t("format")}
              value={kind}
              onChange={setKind}
              columns={3}
              size="sm"
              options={(Object.keys(LABEL) as WriteKind[]).map((k) => ({ value: k, label: LABEL[k] }))}
            />
          </Field>
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("creatorNote")}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={t("createArchive", { format: LABEL[kind] })} />}
      results={<Results outputs={queue.outputs} zipName={`${name || "archive"}.zip`} />}
    />
  );
}
