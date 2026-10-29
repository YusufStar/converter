import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { VIDEO_ACCEPT, formatTime } from "../../lib/media/args";
import { ASPECTS, RESIZE_PRESETS, resizeArgs, resizeTarget, videoOut, type Aspect, type Fit, type ResizeOptions } from "../../lib/media-extra/args";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { ColorField, Field, NumberField, Segmented, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { InputPreview, SlowNote, outputPlayer, useMediaRun } from "../media/shared";
import { s } from "./strings";

type Mode = ResizeOptions["mode"];

const PRESET_TITLES: Record<number, string> = { 2160: "4K UHD", 1440: "QHD", 1080: "Full HD", 720: "HD", 480: "SD", 360: "" };
const ASPECT_HINT = { "16:9": "aspect169", "9:16": "aspect916", "1:1": "aspect11", "4:5": "aspect45" } as const;
const FRAME_SIZES = [null, 1080, 720, 480] as const;
const key = (v: number | null) => (v === null ? "same" : String(v));

export default function ResizeTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const media = useMediaRun(queue);
  const [mode, setMode] = useState<Mode>("preset");
  const [short, setShort] = useState(720);
  const [custom, setCustom] = useState({ width: null as number | null, height: null as number | null, keepAspect: true });
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [frame, setFrame] = useState<number | null>(1080);
  const [fit, setFit] = useState<Fit>("blur");
  const [color, setColor] = useState("#000000");

  const opts: ResizeOptions =
    mode === "preset" ? { mode, short } : mode === "custom" ? { mode, ...custom } : { mode, aspect, short: frame, fit, color };
  const customEmpty = mode === "custom" && !custom.width && !custom.height;

  const run = () =>
    media.run(async (file, exec) => {
      const ext = splitName(file.name).ext;
      const format = videoOut(ext);
      let size: { width: number; height: number } | undefined;
      const r = await exec(({ input, out, info }) => {
        if (info.width && info.height) size = resizeTarget(opts, { width: info.width, height: info.height });
        return { args: resizeArgs(opts, { input, output: `${out}/output.${format}`, info, ext }), duration: info.duration };
      });
      return {
        name: withExt(file.name, format),
        blob: r.files[0].blob,
        width: size?.width,
        height: size?.height,
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
          <InputPreview queue={queue} />
        </div>
      }
      settings={
        <>
          <Field label={t("resizeBy")}>
            <Segmented<Mode>
              label={t("resizeBy")}
              value={mode}
              onChange={setMode}
              columns={3}
              size="sm"
              options={[
                { value: "preset", label: t("byPreset") },
                { value: "custom", label: t("byCustom") },
                { value: "aspect", label: t("byAspect") },
              ]}
            />
          </Field>

          {mode === "preset" ? (
            <Field label={t("resolution")} hint={t("presetHint")}>
              <Segmented
                label={t("resolution")}
                value={short}
                onChange={setShort}
                columns={3}
                size="sm"
                options={RESIZE_PRESETS.map((p) => ({ value: p, label: `${p}p`, title: PRESET_TITLES[p] || undefined }))}
              />
            </Field>
          ) : null}

          {mode === "custom" ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t("width")} value={custom.width} onChange={(width) => setCustom({ ...custom, width })} suffix="px" min={16} max={7680} step={2} placeholder="1280" />
                <NumberField label={t("height")} value={custom.height} onChange={(height) => setCustom({ ...custom, height })} suffix="px" min={16} max={4320} step={2} placeholder="720" />
              </div>
              <Switch checked={custom.keepAspect} onChange={(keepAspect) => setCustom({ ...custom, keepAspect })} label={t("keepAspect")} hint={t(custom.keepAspect ? "keepAspectHint" : "stretchHint")} />
              {customEmpty ? <p className="text-xs text-muted">{t("customMissing")}</p> : null}
            </div>
          ) : null}

          {mode === "aspect" ? (
            <>
              <Field label={t("aspect")} hint={t(ASPECT_HINT[aspect])}>
                <Segmented<Aspect> label={t("aspect")} value={aspect} onChange={setAspect} columns={4} size="sm" options={ASPECTS.map((a) => ({ value: a, label: a, title: t(ASPECT_HINT[a]) }))} />
              </Field>
              <Field label={t("frameSize")}>
                <Segmented
                  label={t("frameSize")}
                  value={key(frame)}
                  onChange={(k) => setFrame(k === "same" ? null : Number(k))}
                  columns={4}
                  size="sm"
                  options={FRAME_SIZES.map((f) => ({ value: key(f), label: f ? `${f}p` : t("sameSize") }))}
                />
              </Field>
              <Field label={t("fit")} hint={t(fit === "crop" ? "fitCropHint" : fit === "pad" ? "fitPadHint" : "fitBlurHint")}>
                <Segmented<Fit>
                  label={t("fit")}
                  value={fit}
                  onChange={setFit}
                  columns={3}
                  size="sm"
                  options={[
                    { value: "crop", label: t("fitCrop") },
                    { value: "pad", label: t("fitPad") },
                    { value: "blur", label: t("fitBlur") },
                  ]}
                />
              </Field>
              {fit === "pad" ? <ColorField label={t("barColor")} value={color} onChange={setColor} /> : null}
            </>
          ) : null}

          <SlowNote>{t("resizeNote")}</SlowNote>
        </>
      }
      action={<RunButton queue={queue} onRun={run} status={media.status} label={n > 1 ? t("resizeN", { n }) : t("resizeOne")} disabled={customEmpty} />}
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {outputPlayer(queue.outputs)}
        </Results>
      }
    />
  );
}
