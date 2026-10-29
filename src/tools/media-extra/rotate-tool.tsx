import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { VIDEO_ACCEPT, formatTime, type Rotation } from "../../lib/media/args";
import { canRotateLossless, rotateArgs, videoOut, type RotateOptions } from "../../lib/media-extra/args";
import { rotateMp4 } from "../../lib/media-extra/mp4-rotate";
import { useObjectUrl } from "../../lib/use-object-url";
import { useQueue, type Queue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { SlowNote, outputPlayer, useMediaRun } from "../media/shared";
import { s } from "./strings";

const ROTATIONS = [
  { value: 0, key: "rotNone" },
  { value: 90, key: "rot90" },
  { value: 180, key: "rot180" },
  { value: 270, key: "rot270" },
] as const;

/** The first queued video, turned and flipped live with CSS. */
function RotatePreview({ queue, o }: { queue: Queue; o: RotateOptions }) {
  const t = useT(s);
  const url = useObjectUrl(queue.items[0]?.file ?? null);
  if (!url) return null;
  const turned = o.rotate % 180 !== 0;
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">{t("rotatePreview")}</h2>
      <div className="flex aspect-video max-h-[52vh] w-full items-center justify-center overflow-hidden rounded-b-2xl bg-black">
        <video
          src={url}
          muted
          loop
          autoPlay
          playsInline
          className="max-h-full max-w-full transition-transform duration-300 ease-out-soft"
          // A quarter turn swaps width and height: shrink so it still fits the 16:9 box.
          style={{ transform: `rotate(${o.rotate}deg) scale(${(o.flipH ? -1 : 1) * (turned ? 0.5625 : 1)}, ${(o.flipV ? -1 : 1) * (turned ? 0.5625 : 1)})` }}
        />
      </div>
    </section>
  );
}

export default function RotateTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const media = useMediaRun(queue);
  const [o, setO] = useState<RotateOptions>({ rotate: 90, flipH: false, flipV: false });
  const [lossless, setLossless] = useState(true);
  const set = (p: Partial<RotateOptions>) => setO((prev) => ({ ...prev, ...p }));

  const exts = queue.items.map((it) => splitName(it.file.name).ext);
  const losslessPossible = exts.length > 0 && exts.every((ext) => canRotateLossless(ext, o));
  const nothing = o.rotate === 0 && !o.flipH && !o.flipV;

  const run = () =>
    media.run(async (file, exec) => {
      const ext = splitName(file.name).ext;
      if (lossless && canRotateLossless(ext, o)) {
        const r = await rotateMp4(file, o.rotate);
        // ponytail: an odd matrix (already flipped) falls through to a re-encode.
        if (r) return { name: file.name, blob: r.blob, note: t("losslessNote", { deg: r.rotation }) };
      }
      const format = videoOut(ext);
      const r = await exec(({ input, out, info }) => ({ args: rotateArgs(o, { input, output: `${out}/output.${format}`, info, ext }), duration: info.duration }));
      const quarter = o.rotate % 180 !== 0;
      return {
        name: withExt(file.name, format),
        blob: r.files[0].blob,
        width: quarter ? r.info.height : r.info.width,
        height: quarter ? r.info.width : r.info.height,
        note: r.info.duration ? formatTime(r.info.duration) : undefined,
      };
    });

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={VIDEO_ACCEPT} formats="MP4, MOV, WEBM, MKV, AVI, M4V, 3GP…" />
          <RotatePreview queue={queue} o={o} />
        </div>
      }
      settings={
        <>
          <Field label={t("rotate")}>
            <Segmented<Rotation>
              label={t("rotate")}
              value={o.rotate}
              onChange={(rotate) => set({ rotate })}
              columns={2}
              size="sm"
              options={ROTATIONS.map((r) => ({ value: r.value, label: t(r.key) }))}
            />
          </Field>
          <Field label={t("flip")}>
            <div className="flex flex-col gap-3">
              <Switch checked={o.flipH} onChange={(flipH) => set({ flipH })} label={t("flipH")} />
              <Switch checked={o.flipV} onChange={(flipV) => set({ flipV })} label={t("flipV")} />
            </div>
          </Field>
          {losslessPossible ? (
            <Switch checked={lossless} onChange={setLossless} label={t("lossless")} hint={t("losslessHint")} />
          ) : n && !nothing ? (
            <p className="text-xs leading-relaxed text-muted">{t("reencodeHint")}</p>
          ) : null}
          {nothing ? <p className="text-xs text-muted">{t("nothingToDo")}</p> : null}
          {losslessPossible && lossless ? null : <SlowNote />}
        </>
      }
      action={<RunButton queue={queue} onRun={run} status={losslessPossible && lossless ? null : media.status} label={n > 1 ? t("rotateN", { n }) : t("rotateOne")} disabled={nothing} />}
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {outputPlayer(queue.outputs)}
        </Results>
      }
    />
  );
}
