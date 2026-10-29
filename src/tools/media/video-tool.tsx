import { useState, type ReactNode } from "react";
import type { EngineProps } from "../../engines";
import { withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import {
  VIDEO_ACCEPT,
  clipLength,
  formatTime,
  gifArgs,
  mpeg4Q,
  outputSize,
  parseRange,
  targetVideoKbps,
  videoArgs,
  vp8Crf,
  x264Crf,
  type Rotation,
  type VideoFormat,
  type VideoOptions,
} from "../../lib/media/args";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, NumberField, Segmented, Slider, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { InputPreview, SlowNote, TrimFields, markRange, outputPlayer, useMediaRun, type RangeText } from "./shared";
import { s } from "./strings";

interface Preset {
  format?: VideoFormat;
  focus?: "compress" | "gif";
}

type Level = "light" | "balanced" | "strong";

const LEVELS: Record<Level, { quality: number; height: number | null; audioKbps: number }> = {
  light: { quality: 62, height: null, audioKbps: 128 },
  balanced: { quality: 50, height: 720, audioKbps: 96 },
  strong: { quality: 35, height: 480, audioKbps: 64 },
};

const HEIGHTS = [null, 1080, 720, 480, 360] as const;
const FPS = [null, 60, 30, 24, 15] as const;
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const GIF_FPS = [5, 10, 15, 20, 25];
const GIF_WIDTHS = [null, 320, 480, 640, 800] as const;

const optKey = (v: number | null) => (v === null ? "orig" : String(v));
const fromKey = (k: string) => (k === "orig" ? null : Number(k));

export default function VideoTool({ meta }: EngineProps) {
  const t = useT(s);
  const preset = (meta.preset ?? {}) as Preset;
  const compress = preset.focus === "compress";
  const gifFocus = preset.focus === "gif";
  const queue = useQueue();
  const media = useMediaRun(queue);

  const [format, setFormat] = useState<VideoFormat>(preset.format ?? "mp4");
  const [height, setHeight] = useState<number | null>(null);
  const [quality, setQuality] = useState(75);
  const [fps, setFps] = useState<number | null>(null);
  const [range, setRange] = useState<RangeText>({ start: "", end: "" });
  const [mute, setMute] = useState(false);
  const [rotate, setRotate] = useState<Rotation>(0);
  const [gif, setGif] = useState({ fps: 15, width: 480 as number | null, loop: true, hq: true });
  const [level, setLevel] = useState<Level>("balanced");
  const [target, setTarget] = useState(false);
  const [targetMB, setTargetMB] = useState<number | null>(25);

  const isGif = format === "gif";
  const { start, end, error } = parseRange(range.start, range.end, gifFocus);
  const lvl = LEVELS[level];
  const crfLabel = (q: number) => (q >= 90 ? t("qMax") : q >= 70 ? t("qHigh") : q >= 50 ? t("qBalanced") : q >= 30 ? t("qSmall") : t("qTiny"));
  const crf = format === "webm" ? vp8Crf(quality) : format === "avi" ? mpeg4Q(quality) : x264Crf(quality);

  const formatField = (
    <Field key="format" label={t("format")} hint={t(`${format}Hint` as const)}>
      <Segmented<VideoFormat>
        label={t("format")}
        value={format}
        onChange={setFormat}
        columns={compress ? 2 : 3}
        size="sm"
        options={(compress ? (["mp4", "webm"] as const) : (["mp4", "webm", "mov", "mkv", "avi", "gif"] as const)).map((f) => ({ value: f, label: f.toUpperCase() }))}
      />
    </Field>
  );

  const gifSection = (
    <div key="gif" className="flex flex-col gap-5">
      <Field label={t("gifFps")}>
        <Segmented label={t("gifFps")} value={gif.fps} onChange={(v) => setGif({ ...gif, fps: v })} columns={5} size="sm" options={GIF_FPS.map((f) => ({ value: f, label: String(f) }))} />
      </Field>
      <Field label={t("gifWidth")} hint={t("gifTip")}>
        <Segmented
          label={t("gifWidth")}
          value={optKey(gif.width)}
          onChange={(k) => setGif({ ...gif, width: fromKey(k) })}
          columns={5}
          size="sm"
          options={GIF_WIDTHS.map((w) => ({ value: optKey(w), label: w ?? t("same"), title: w ? `${w} px` : t("original") }))}
        />
      </Field>
      <div className="flex flex-col gap-4">
        <Switch checked={gif.hq} onChange={(hq) => setGif({ ...gif, hq })} label={t("gifHq")} hint={t("gifHqHint")} />
        <Switch checked={gif.loop} onChange={(loop) => setGif({ ...gif, loop })} label={t("gifLoop")} />
      </div>
    </div>
  );

  const videoSections: ReactNode = (
    <>
      <Field label={t("resolution")} hint={t("resolutionHint")}>
        <Segmented
          label={t("resolution")}
          value={optKey(height)}
          onChange={(k) => setHeight(fromKey(k))}
          columns={5}
          size="sm"
          options={HEIGHTS.map((h) => ({ value: optKey(h), label: h ? `${h}p` : t("same"), title: h ? undefined : t("original") }))}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <Slider label={t("quality")} value={quality} onChange={setQuality} min={0} max={100} suffix="%" marks={[t("smaller"), t("better")]} />
        <p className="text-xs text-muted">
          {crfLabel(quality)} · {format === "avi" ? "q" : "CRF"} {crf}
        </p>
      </div>
      <Field label={t("fps")}>
        <Segmented
          label={t("fps")}
          value={optKey(fps)}
          onChange={(k) => setFps(fromKey(k))}
          columns={5}
          size="sm"
          options={FPS.map((f) => ({ value: optKey(f), label: f ?? t("same"), title: f ? `${f} fps` : t("original") }))}
        />
      </Field>
    </>
  );

  const rotateField = (
    <Field key="rotate" label={t("rotate")}>
      <Segmented<Rotation> label={t("rotate")} value={rotate} onChange={setRotate} columns={4} size="sm" options={ROTATIONS.map((r) => ({ value: r, label: `${r}°` }))} />
    </Field>
  );

  const trim = <TrimFields key="trim" value={range} onChange={setRange} isLength={gifFocus} />;
  const audio = <Switch key="mute" checked={mute} onChange={setMute} label={t("removeAudio")} hint={t("removeAudioHint")} />;

  const settings = compress ? (
    <>
      <Field label={t("level")} hint={t(`${level}Hint` as const)}>
        <Segmented<Level>
          label={t("level")}
          value={level}
          onChange={setLevel}
          columns={3}
          size="sm"
          options={(["light", "balanced", "strong"] as const).map((l) => ({ value: l, label: t(l) }))}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <Switch checked={target} onChange={setTarget} label={t("targetSize")} hint={t("targetSizeHint")} />
        {target ? <NumberField label={t("targetMB")} value={targetMB} onChange={setTargetMB} suffix="MB" min={1} placeholder="25" /> : null}
      </div>
      {formatField}
      {audio}
    </>
  ) : gifFocus ? (
    <>
      {gifSection}
      {trim}
      {rotateField}
    </>
  ) : (
    <>
      {formatField}
      {isGif ? gifSection : videoSections}
      {trim}
      {isGif ? null : audio}
      {rotateField}
    </>
  );

  const run = () =>
    media.run(async (file, exec) => {
      let length: number | undefined;
      const r = await exec(({ input, out, info }) => {
        const io = { input, output: `${out}/output.${format}`, info };
        length = clipLength(info.duration, start, end);
        if (format === "gif") return { args: gifArgs({ ...gif, start, end, rotate }, io), duration: length };
        const audioKbps = compress ? lvl.audioKbps : 128;
        let videoKbps: number | null = null;
        if (compress && target && targetMB) {
          if (!length) throw new Error(t("noDuration"));
          videoKbps = targetVideoKbps(targetMB, length, mute ? 0 : audioKbps);
        }
        const opts: VideoOptions = compress
          ? { format, height: lvl.height, quality: lvl.quality, videoKbps, audioKbps, fps: null, start: null, end: null, mute, rotate: 0 }
          : { format, height, quality, audioKbps, fps, start, end, mute, rotate };
        return { args: videoArgs(opts, io), duration: length };
      });
      const size = isGif ? null : outputSize(r.info, compress ? lvl.height : height, compress ? 0 : rotate);
      const blob = r.files[0].blob;
      const missed = compress && target && targetMB && blob.size > targetMB * 1024 * 1024 * 1.05;
      return {
        name: withExt(file.name, format),
        blob,
        width: size?.width,
        height: size?.height,
        note: [length ? formatTime(length) : null, missed ? t("targetMissed") : null].filter(Boolean).join(" · ") || undefined,
      };
    });

  const n = queue.items.length;
  const label = compress ? (n > 1 ? t("compressN", { n }) : t("compressOne")) : isGif ? (n > 1 ? t("makeGifs", { n }) : t("makeGif")) : n > 1 ? t("convertN", { n }) : t("convertOne");
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={VIDEO_ACCEPT} formats="MP4, MOV, WEBM, MKV, AVI, M4V, 3GP, FLV, WMV, TS…" />
          <InputPreview queue={queue} onMark={compress ? undefined : (which, sec) => setRange((r) => markRange(r, which, sec, gifFocus))} />
        </div>
      }
      settings={
        <>
          {settings}
          <SlowNote />
        </>
      }
      action={
        <RunButton
          queue={queue}
          onRun={run}
          label={label}
          status={media.status}
          disabled={(!compress && !!error) || (compress && target && !targetMB)}
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
