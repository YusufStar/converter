import { useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { formatBytes, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { decodeImage } from "../../lib/image/decode";
import { encodeCanvas, hasTransparency, pixels } from "../../lib/image/encode";
import { FORMATS, inputKind } from "../../lib/image/formats";
import { readGroups, removalReport, type Groups } from "../../lib/image-extra/exif";
import { losslessFormat, stripMetadata, type StripKind } from "../../lib/image-extra/strip";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { EXIF_ACCEPT, EXIF_FORMATS } from "./shared";
import { s } from "./strings";

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

const groupsOf = (b: Uint8Array): Promise<Groups> => readGroups(b).catch(() => ({}));

/** HEIC, AVIF, TIFF…: decode and re-encode (pixels only, so nothing else survives). */
async function reencode(file: File): Promise<{ blob: Blob; ext: string; label: string }> {
  const img = await decodeImage(file);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.drawImage(img.source, 0, 0);
  } finally {
    img.close();
  }
  const fmt = inputKind(file) === "tiff" || hasTransparency(pixels(canvas)) ? "png" : "jpg";
  const blob = await encodeCanvas(canvas, fmt, { quality: 92, lossless: false, pngColors: 0, icoSizes: [] });
  canvas.width = canvas.height = 0;
  return { blob, ext: FORMATS[fmt].ext, label: FORMATS[fmt].label };
}

export default function RemoveExifTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [keepIcc, setKeepIcc] = useState(true);
  const n = queue.items.length;

  const run = () =>
    queue.runEach(async (file, ctx) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const before = await groupsOf(bytes);
      ctx.progress(0.3);
      const container = losslessFormat(bytes);
      let blob: Blob;
      let name = file.name;
      let after: Groups = {};
      let kinds = new Set<StripKind>();
      let kept = false;
      let reencoded: string | null = null;
      if (container) {
        const r = stripMetadata(bytes, { keepIcc });
        blob = new Blob([r.bytes as BlobPart], { type: MIME[container] });
        after = await groupsOf(r.bytes);
        kinds = new Set(r.removed.map((x) => x.kind));
        kept = r.keptOrientation;
      } else {
        const r = await reencode(file);
        blob = r.blob;
        name = withExt(file.name, r.ext);
        reencoded = r.label;
      }

      const rep = removalReport(before, after);
      const parts: string[] = [];
      if (rep.gps) parts.push(t("nGps"));
      if (rep.camera) parts.push(t("nCamera"));
      if (rep.date) parts.push(t("nDate"));
      if (kinds.has("comment")) parts.push(t("nComment"));
      if (kinds.has("icc")) parts.push(t("nIcc"));
      if (kinds.has("extra")) parts.push(t("nExtra"));
      if (rep.tags) parts.push(rep.tags === 1 ? t("nTag") : t("nTags", { n: rep.tags }));
      const notes = [parts.length ? t("removedList", { list: parts.join(", ") }) : t("nothingFound")];
      if (reencoded) notes.unshift(t("reencoded", { format: reencoded }));
      if (file.size > blob.size) notes.push(`−${formatBytes(file.size - blob.size)}`);
      if (kept) notes.push(t("keptOrientation"));
      return { name, blob, note: notes.join(" · ") };
    }, 4);

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={EXIF_ACCEPT} formats={EXIF_FORMATS} />}
      settings={
        <>
          <Switch checked={keepIcc} onChange={setKeepIcc} label={t("keepIcc")} hint={t("keepIccHint")} />
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("stripInfo")}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("stripRunN", { n }) : t("stripRun")} />}
      results={<Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
