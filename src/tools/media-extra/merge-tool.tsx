import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { VIDEO_ACCEPT, formatTime } from "../../lib/media/args";
import { runFFmpeg } from "../../lib/media/ffmpeg";
import { canConcatCopy, concatArgs, concatList, copyContainer, mergeTarget, normalizeArgs } from "../../lib/media-extra/args";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { InputPreview, SlowNote, outputPlayer, useEngineStatus } from "../media/shared";
import { s } from "./strings";

type Join = "auto" | "encode";

const SIZES = [null, 1080, 720, 480] as const;
const RATES = [null, 60, 30, 25, 24] as const;
const key = (v: number | null) => (v === null ? "first" : String(v));
const unkey = (k: string) => (k === "first" ? null : Number(k));

export default function MergeTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const engine = useEngineStatus();
  const [join, setJoin] = useState<Join>("auto");
  const [short, setShort] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const run = () =>
    queue.runAll(async (files, { signal, progress }) => {
      try {
        setStep(t("probing"));
        const { infos } = await runFFmpeg(files, () => null, { signal });
        const missing = infos.findIndex((i) => !i.video);
        if (missing >= 0) throw new Error(t("noVideo", { name: files[missing].name }));
        const total = infos.reduce((a, i) => a + (i.duration ?? 0), 0) || undefined;
        const base = splitName(files[0].name).base;
        const length = total ? formatTime(total) : null;

        // Matching clips: one stream-copy pass, no quality loss.
        if (join === "auto" && canConcatCopy(infos)) {
          const format = copyContainer(splitName(files[0].name).ext);
          setStep(t("joining"));
          const r = await runFFmpeg(
            files,
            ({ inputs, out, work }) => ({ write: { "list.txt": concatList(inputs) }, args: concatArgs(`${work}/list.txt`, `${out}/merged.${format}`, format), duration: total }),
            { signal, onProgress: progress },
          );
          return [{ name: `${base}-merged.${format}`, blob: r.files[0].blob, width: infos[0].width, height: infos[0].height, note: [t("copied"), length].filter(Boolean).join(" · ") }];
        }

        // Otherwise bring every clip to the same frame, then stream-copy the parts together.
        const target = mergeTarget(infos[0], short, fps);
        const parts: File[] = [];
        let done = 0;
        for (const [i, file] of files.entries()) {
          setStep(t("clipOf", { i: i + 1, n: files.length }));
          const d = infos[i].duration ?? 0;
          const r = await runFFmpeg(file, ({ input, out, info }) => ({ args: normalizeArgs(target, { input, output: `${out}/part.mp4`, info }), duration: d || undefined }), {
            signal,
            onProgress: (p) => progress(total ? ((done + p * d) / total) * 0.97 : (i + p) / files.length),
          });
          done += d;
          parts.push(new File([r.files[0].blob], `${i}.mp4`, { type: "video/mp4" }));
        }
        setStep(t("joining"));
        const r = await runFFmpeg(
          parts,
          ({ inputs, out, work }) => ({ write: { "list.txt": concatList(inputs) }, args: concatArgs(`${work}/list.txt`, `${out}/merged.mp4`, "mp4"), duration: total }),
          { signal, onProgress: (p) => progress(0.97 + p * 0.03) },
        );
        return [
          {
            name: `${base}-merged.mp4`,
            blob: r.files[0].blob,
            width: target.width,
            height: target.height,
            note: [t("encoded", { w: target.width, h: target.height, fps: Math.round(target.fps * 100) / 100 }), length].filter(Boolean).join(" · "),
          },
        ];
      } finally {
        setStep(null);
      }
    });

  const n = queue.items.length;
  const pct = Math.round(queue.progress * 100);
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={VIDEO_ACCEPT} formats="MP4, MOV, WEBM, MKV, AVI, M4V, 3GP…" reorderable />
          {n > 1 ? <p className="px-1 text-xs text-muted">{t("orderHint")}</p> : null}
          <InputPreview queue={queue} />
        </div>
      }
      settings={
        <>
          <Field label={t("join")} hint={t(join === "auto" ? "joinAutoHint" : "joinEncodeHint")}>
            <Segmented<Join>
              label={t("join")}
              value={join}
              onChange={setJoin}
              columns={2}
              size="sm"
              options={[
                { value: "auto", label: t("joinAuto") },
                { value: "encode", label: t("joinEncode") },
              ]}
            />
          </Field>
          <Field label={t("mergeSize")} hint={t("mergeSizeHint")}>
            <Segmented
              label={t("mergeSize")}
              value={key(short)}
              onChange={(k) => setShort(unkey(k))}
              columns={4}
              size="sm"
              options={SIZES.map((v) => ({ value: key(v), label: v ? `${v}p` : t("firstClip") }))}
            />
          </Field>
          <Field label={t("mergeFps")}>
            <Segmented
              label={t("mergeFps")}
              value={key(fps)}
              onChange={(k) => setFps(unkey(k))}
              columns={5}
              size="sm"
              options={RATES.map((v) => ({ value: key(v), label: v ? String(v) : t("firstClip"), title: v ? `${v} fps` : undefined }))}
            />
          </Field>
          <SlowNote />
        </>
      }
      action={
        <RunButton
          queue={queue}
          onRun={run}
          status={engine ?? (step ? `${step} ${pct}%` : null)}
          label={n < 2 ? t("mergeOne") : t("mergeN", { n })}
          disabled={n < 2}
        />
      }
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {outputPlayer(queue.outputs)}
        </Results>
      }
    />
  );
}
