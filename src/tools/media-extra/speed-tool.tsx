import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { VIDEO_ACCEPT, formatTime } from "../../lib/media/args";
import { REVERSE_LIMIT, SPEEDS, maxReverseSeconds, reverseBytes, speedArgs, videoOut } from "../../lib/media-extra/args";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, Slider, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { InputPreview, SlowNote, outputPlayer, useMediaRun } from "../media/shared";
import { s } from "./strings";

const label = (x: number) => `${x}×`;

export default function SpeedTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const media = useMediaRun(queue);
  const [speed, setSpeed] = useState(2);
  const [audio, setAudio] = useState(true);
  const [reverse, setReverse] = useState(false);

  const run = () =>
    media.run(async (file, exec) => {
      const ext = splitName(file.name).ext;
      const format = videoOut(ext);
      let note: string | undefined;
      const r = await exec(({ input, out, info }) => {
        if (reverse && reverseBytes(info) > REVERSE_LIMIT) throw new Error(t("tooLongToReverse", { n: maxReverseSeconds(info) }));
        const duration = info.duration ? info.duration / speed : undefined;
        if (info.duration && duration) note = t("lengthNote", { from: formatTime(info.duration), to: formatTime(duration) });
        return { args: speedArgs({ speed, audio, reverse }, { input, output: `${out}/output.${format}`, info, ext }), duration };
      });
      return { name: withExt(file.name, format), blob: r.files[0].blob, width: r.info.width, height: r.info.height, note };
    });

  const n = queue.items.length;
  const action = speed === 1 && reverse ? t("reverseOne") : n > 1 ? t("speedN", { n }) : t("speedOne");
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={VIDEO_ACCEPT} formats="MP4, MOV, WEBM, MKV, AVI, M4V, 3GP…" />
          <InputPreview queue={queue} />
        </div>
      }
      settings={
        <>
          <Field label={t("speed")} hint={t("speedHint")}>
            <div className="flex flex-col gap-3">
              <Segmented label={t("speed")} value={speed} onChange={setSpeed} columns={4} size="sm" options={SPEEDS.filter((x) => x !== 1.25).map((x) => ({ value: x, label: label(x) }))} />
              <Slider label={t("exactSpeed")} value={speed} onChange={setSpeed} min={0.25} max={4} step={0.05} suffix="×" />
            </div>
          </Field>
          <div className="flex flex-col gap-4">
            <Switch checked={audio} onChange={setAudio} label={t("keepAudio")} hint={t("keepAudioHint")} />
            <Switch checked={reverse} onChange={setReverse} label={t("reverse")} hint={t("reverseHint")} />
          </div>
          <SlowNote />
        </>
      }
      action={<RunButton queue={queue} onRun={run} status={media.status} label={action} disabled={speed === 1 && !reverse && audio} />}
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {outputPlayer(queue.outputs)}
        </Results>
      }
    />
  );
}
