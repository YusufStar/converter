import { useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { renderToCanvas } from "../../lib/image/convert";
import { IMAGE_ACCEPT, IMAGE_FORMATS_LABEL } from "../../lib/image/formats";
import { makeAnimatedGif } from "../../lib/image/gif";
import { DEFAULT_RESIZE } from "../../lib/image/resize";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { ColorField, Field, Segmented, Slider, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

const WIDTHS = [240, 320, 480, 640, 800, 0] as const;

export default function GifMakerTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [delay, setDelay] = useState(500);
  const [width, setWidth] = useState<number>(480);
  const [loop, setLoop] = useState(true);
  const [bg, setBg] = useState("#ffffff");

  const run = () =>
    queue.runAll(async (files, ctx) => {
      const resize = width ? { ...DEFAULT_RESIZE, mode: "dimensions" as const, width, height: null, noEnlarge: true } : DEFAULT_RESIZE;
      let frameW = 0;
      let frameH = 0;
      const frames: ImageData[] = [];
      for (let i = 0; i < files.length; i++) {
        if (ctx.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const src = await renderToCanvas(files[i], { resize, rotate: 0, flipH: false, flipV: false, background: null });
        if (i === 0) {
          frameW = src.width;
          frameH = src.height;
        }
        // Every frame is centred (contained) on the first frame's canvas.
        const c = document.createElement("canvas");
        c.width = frameW;
        c.height = frameH;
        const g = c.getContext("2d")!;
        g.fillStyle = bg;
        g.fillRect(0, 0, frameW, frameH);
        const f = Math.min(frameW / src.width, frameH / src.height);
        const w = Math.round(src.width * f);
        const h = Math.round(src.height * f);
        g.imageSmoothingQuality = "high";
        g.drawImage(src, Math.round((frameW - w) / 2), Math.round((frameH - h) / 2), w, h);
        frames.push(g.getImageData(0, 0, frameW, frameH));
        ctx.progress(((i + 1) / files.length) * 0.7);
      }
      const bytes = await makeAnimatedGif(frames, { delay, loop });
      ctx.progress(1);
      return [{ name: "animation.gif", blob: new Blob([bytes as BlobPart], { type: "image/gif" }), width: frameW, height: frameH }];
    });

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={IMAGE_ACCEPT} formats={IMAGE_FORMATS_LABEL} reorderable />}
      settings={
        <>
          <Slider label={t("gifDelay")} value={delay} onChange={setDelay} min={20} max={3000} step={10} suffix=" ms" />
          <Field label={t("gifSize")}>
            <Segmented<number>
              label={t("gifSize")}
              value={width}
              onChange={setWidth}
              columns={3}
              size="sm"
              options={WIDTHS.map((w) => ({ value: w, label: w ? `${w}px` : t("original") }))}
            />
          </Field>
          <Switch checked={loop} onChange={setLoop} label={t("gifLoop")} />
          <ColorField label={t("background")} value={bg} onChange={setBg} />
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("gifOrder")} {t("gifFit")}
            </span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={t("gifMake")} />}
      results={<Results outputs={queue.outputs} />}
    />
  );
}
