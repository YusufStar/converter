import { useState } from "react";
import type { EngineProps } from "../../engines";
import { withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import {
  AUDIO_ACCEPT,
  AUDIO_FORMATS,
  LOSSLESS_AUDIO,
  VIDEO_ACCEPT,
  audioArgs,
  clipLength,
  formatTime,
  parseRange,
  type AudioFormat,
  type AudioOptions,
} from "../../lib/media/args";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, NumberField, Segmented, Slider, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { InputPreview, SlowNote, TrimFields, markRange, outputPlayer, useMediaRun, type RangeText } from "./shared";
import { s } from "./strings";

interface Preset {
  format?: AudioFormat;
  /** "video": extraction tool (video inputs first). */
  source?: "video" | "audio";
}

const BITRATES = [96, 128, 192, 256, 320];
const RATES = [null, 48000, 44100, 22050] as const;
const key = (v: number | null) => (v === null ? "orig" : String(v));
const unkey = (k: string) => (k === "orig" ? null : Number(k));

export default function AudioTool({ meta }: EngineProps) {
  const t = useT(s);
  const preset = (meta.preset ?? {}) as Preset;
  const fromVideo = preset.source === "video";
  const queue = useQueue();
  const media = useMediaRun(queue);
  const [o, setO] = useState<Omit<AudioOptions, "start" | "end">>({
    format: preset.format ?? "mp3",
    kbps: 192,
    sampleRate: null,
    channels: null,
    volume: 100,
    normalize: false,
    fadeIn: 0,
    fadeOut: 0,
  });
  const set = (p: Partial<AudioOptions>) => setO((prev) => ({ ...prev, ...p }));
  const [range, setRange] = useState<RangeText>({ start: "", end: "" });
  const { start, end, error } = parseRange(range.start, range.end);
  const lossless = LOSSLESS_AUDIO.has(o.format);

  const run = () =>
    media.run(async (file, exec) => {
      let length: number | undefined;
      const r = await exec(({ input, out, info }) => {
        length = clipLength(info.duration, start, end);
        return { args: audioArgs({ ...o, start, end }, { input, output: `${out}/output.${o.format}`, info }), duration: length };
      });
      return { name: withExt(file.name, o.format), blob: r.files[0].blob, note: length ? formatTime(length) : undefined };
    });

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput
            queue={queue}
            accept={fromVideo ? `${VIDEO_ACCEPT},${AUDIO_ACCEPT}` : `${AUDIO_ACCEPT},${VIDEO_ACCEPT}`}
            formats={fromVideo ? "MP4, MOV, WEBM, MKV, AVI… + audio" : "MP3, WAV, M4A, AAC, OGG, OPUS, FLAC, AIFF, WMA… + video"}
          />
          <InputPreview queue={queue} onMark={(which, sec) => setRange((r) => markRange(r, which, sec))} />
        </div>
      }
      settings={
        <>
          <Field label={t("format")} hint={t(`${o.format}Hint` as const)}>
            <Segmented<AudioFormat>
              label={t("format")}
              value={o.format}
              onChange={(format) => set({ format })}
              columns={4}
              size="sm"
              options={AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </Field>
          <Field label={t("bitrate")} hint={lossless ? t("losslessHint", { format: o.format.toUpperCase() }) : t("bitrateHint")}>
            {lossless ? null : (
              <Segmented label={t("bitrate")} value={o.kbps} onChange={(kbps) => set({ kbps })} columns={5} size="sm" options={BITRATES.map((b) => ({ value: b, label: `${b}k` }))} />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <Field label={t("sampleRate")} hint={o.format === "opus" ? t("opusRate") : undefined}>
              <Segmented
                label={t("sampleRate")}
                value={o.format === "opus" ? "orig" : key(o.sampleRate)}
                onChange={(k) => set({ sampleRate: unkey(k) })}
                columns={4}
                size="sm"
                options={RATES.map((r) => ({ value: key(r), label: r ? `${r / 1000}k` : t("original"), disabled: o.format === "opus" && r !== null }))}
              />
            </Field>
            <Field label={t("channels")}>
              <Segmented
                label={t("channels")}
                value={key(o.channels)}
                onChange={(k) => set({ channels: unkey(k) as 1 | 2 | null })}
                columns={3}
                size="sm"
                options={[
                  { value: "orig", label: t("original") },
                  { value: "1", label: t("mono") },
                  { value: "2", label: t("stereo") },
                ]}
              />
            </Field>
          </div>
          <TrimFields value={range} onChange={setRange} />
          <div className="flex flex-col gap-4">
            <Switch checked={o.normalize} onChange={(normalize) => set({ normalize })} label={t("normalize")} hint={t("normalizeHint")} />
            {o.normalize ? null : <Slider label={t("volume")} value={o.volume} onChange={(volume) => set({ volume })} min={0} max={200} step={5} suffix="%" />}
          </div>
          <Field label={t("fades")}>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t("fadeIn")} value={o.fadeIn || null} onChange={(v) => set({ fadeIn: Math.max(0, v ?? 0) })} suffix="s" min={0} step={0.5} placeholder="0" />
              <NumberField label={t("fadeOut")} value={o.fadeOut || null} onChange={(v) => set({ fadeOut: Math.max(0, v ?? 0) })} suffix="s" min={0} step={0.5} placeholder="0" />
            </div>
          </Field>
          <SlowNote />
        </>
      }
      action={
        <RunButton
          queue={queue}
          onRun={run}
          status={media.status}
          label={fromVideo ? (n > 1 ? t("extractN", { n }) : t("extractOne")) : n > 1 ? t("convertN", { n }) : t("convertOne")}
          disabled={!!error}
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
