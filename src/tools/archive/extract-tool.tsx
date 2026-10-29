import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { EngineProps } from "../../engines";
import { extractArchive } from "../../lib/archive/archive";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

// Typed blobs get thumbnails in the results list.
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  zip: "application/zip",
};

/** "site.tar.gz" → "site", "a.zip" → "a" */
const archiveBase = (name: string) => name.replace(/\.(tar\.gz|tgz|tar|zip|gz)$/i, "") || name;

export default function ExtractTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [keep, setKeep] = useState(true);

  const run = () => {
    const multi = queue.items.length > 1;
    // One archive at a time: unpacked archives can be large.
    return queue.runEach(async (file) => {
      const entries = await extractArchive(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!entries.length) throw new Error("The archive is empty");
      return entries.map((e) => {
        const slash = e.path.lastIndexOf("/");
        const base = e.path.slice(slash + 1);
        const dir = slash >= 0 ? e.path.slice(0, slash) : "";
        return {
          name: keep ? (multi ? `${archiveBase(file.name)}/${e.path}` : e.path) : base,
          blob: new Blob([e.data as BlobPart], { type: MIME[splitName(base).ext] ?? "" }),
          sourceSize: undefined,
          note: !keep && dir ? t("inFolder", { path: dir }) : undefined,
        };
      });
    }, 1);
  };

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept=".zip,.tar,.tgz,.gz" formats="ZIP, TAR, TAR.GZ, TGZ, GZ" />}
      settings={
        <>
          <Switch checked={keep} onChange={setKeep} label={t("keepFolders")} hint={t("keepFoldersHint")} />
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("limitNote")}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("extractN", { n }) : t("extract")} />}
      results={<Results outputs={queue.outputs} zipName={n === 1 ? `${archiveBase(queue.items[0].file.name)}.zip` : "extracted.zip"} />}
    />
  );
}
