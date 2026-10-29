import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { VIDEO_ACCEPT, formatTime, frameExt, framesArgs, parseRange, type FrameFormat } from "../../lib/media/args";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { InputPreview, SlowNote, TrimFields, markRange, useMediaRun, type RangeText } from "./shared";
import { s } from "./strings";

const EVERY = [0.5, 1, 2, 5, 10];
const WIDTHS = [null, 320, 640, 1280, 1920] as const;
const key = (v: number | null) => (v === null ? "orig" : String(v));

async function pngToJpeg(png: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(png);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

/** Video → one image every N seconds (JPG/PNG/WebP), many results → ZIP. */
export default function FramesTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const media = useMediaRun(queue);
  const [every, setEvery] = useState(1);
  const [format, setFormat] = useState<FrameFormat>("jpg");
  const [width, setWidth] = useState<number | null>(null);
  const [range, setRange] = useState<RangeText>({ start: "", end: "" });
  const { start, end, error } = parseRange(range.start, range.end);

  const run = () =>
    media.run(async (file, exec) => {
      const r = await exec(({ input, out, info }) => ({
        args: framesArgs({ every, format, width, start, end }, { input, output: `${out}/%04d.${frameExt(format)}`, info }),
      }));
      const base = splitName(file.name).base;
      return Promise.all(
        r.files.map(async (f, i) => ({
          name: `${base}-${splitName(f.name).base}.${format}`,
          blob: format === "jpg" ? await pngToJpeg(f.blob) : f.blob,
          note: formatTime((start ?? 0) + i * every),
        })),
      );
    });

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={VIDEO_ACCEPT} formats="MP4, MOV, WEBM, MKV, AVI…" />
          <InputPreview queue={queue} onMark={(which, sec) => setRange((r) => markRange(r, which, sec))} />
        </div>
      }
      settings={
        <>
          <Field label={t("every")}>
            <Segmented label={t("every")} value={every} onChange={setEvery} columns={5} size="sm" options={EVERY.map((e) => ({ value: e, label: `${e}s` }))} />
          </Field>
          <Field label={t("imageFormat")}>
            <Segmented<FrameFormat>
              label={t("imageFormat")}
              value={format}
              onChange={setFormat}
              columns={3}
              size="sm"
              options={(["jpg", "png", "webp"] as const).map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </Field>
          <Field label={t("frameWidth")}>
            <Segmented
              label={t("frameWidth")}
              value={key(width)}
              onChange={(k) => setWidth(k === "orig" ? null : Number(k))}
              columns={5}
              size="sm"
              options={WIDTHS.map((w) => ({ value: key(w), label: w ?? t("same"), title: w ? `${w} px` : t("original") }))}
            />
          </Field>
          <TrimFields value={range} onChange={setRange} />
          <SlowNote>{t("framesHint")}</SlowNote>
        </>
      }
      action={<RunButton queue={queue} onRun={run} status={media.status} label={n > 1 ? t("framesN", { n }) : t("framesOne")} disabled={!!error} />}
      results={<Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
