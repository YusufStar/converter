import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { VIDEO_ACCEPT, clipLength, formatTime, muteArgs, parseRange, sameContainer, trimArgs } from "../../lib/media/args";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { InputPreview, SlowNote, TrimFields, markRange, outputPlayer, useMediaRun, type RangeText } from "./shared";
import { s } from "./strings";

/** Trim (stream copy or frame-accurate re-encode) and mute — both keep the input's container. */
export default function TrimTool({ meta }: EngineProps) {
  const t = useT(s);
  const mute = (meta.preset as { mode?: string } | undefined)?.mode === "mute";
  const queue = useQueue();
  const media = useMediaRun(queue);
  const [range, setRange] = useState<RangeText>({ start: "", end: "" });
  const [precise, setPrecise] = useState(false);
  const { start, end, error } = parseRange(range.start, range.end);

  const run = () =>
    media.run(async (file, exec) => {
      const ext = sameContainer(splitName(file.name).ext, !mute && precise);
      let length: number | undefined;
      const r = await exec(({ input, out, info }) => {
        const io = { input, output: `${out}/output.${ext}`, info };
        length = mute ? info.duration : clipLength(info.duration, start, end);
        return { args: mute ? muteArgs(io) : trimArgs({ start, end, precise, ext }, io), duration: length };
      });
      return { name: withExt(file.name, ext), blob: r.files[0].blob, width: r.info.width, height: r.info.height, note: length ? formatTime(length) : undefined };
    });

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={VIDEO_ACCEPT} formats="MP4, MOV, WEBM, MKV, AVI, M4V, 3GP, TS…" />
          <InputPreview queue={queue} onMark={mute ? undefined : (which, sec) => setRange((r) => markRange(r, which, sec))} />
        </div>
      }
      settings={
        mute ? (
          <SlowNote>{t("muteNote")}</SlowNote>
        ) : (
          <>
            <TrimFields value={range} onChange={setRange} required />
            <Switch checked={precise} onChange={setPrecise} label={t("precise")} hint={t("preciseHint")} />
            <SlowNote />
          </>
        )
      }
      action={
        <RunButton
          queue={queue}
          onRun={run}
          status={media.status}
          label={mute ? (n > 1 ? t("muteN", { n }) : t("muteOne")) : n > 1 ? t("trimN", { n }) : t("trimOne")}
          disabled={!mute && (!!error || (start === null && end === null))}
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
