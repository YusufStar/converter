import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { IMAGE_ACCEPT, IMAGE_FORMATS_LABEL, inputKind } from "../../lib/image/formats";
import { writeGif } from "../../lib/image/gif";
import { concurrency, runJob, warmPool } from "../../lib/image/pool";
import { DEFAULT_RESIZE } from "../../lib/image/resize";
import { mapPool } from "../../lib/pool";
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

  const workers = concurrency(queue.items.some((it) => inputKind(it.file) === "raw"));
  useEffect(() => warmPool([], workers), [workers]);

  const run = () =>
    queue.runAll(async (files, ctx) => {
      const resize = width ? { ...DEFAULT_RESIZE, mode: "dimensions" as const, width, height: null, noEnlarge: true } : DEFAULT_RESIZE;
      // The first frame sets the canvas; every other frame is centred (contained) on it, in parallel workers.
      const first = await runJob("gifFrame", files[0], [{ resize, background: bg }], resize, ctx.signal);
      const frame = { width: first.width, height: first.height };
      let done = 1;
      ctx.progress(0.7 / files.length);
      const rest = await mapPool(files.slice(1), workers, async (f) => {
        const q = await runJob("gifFrame", f, [{ resize, background: bg, frame }], resize, ctx.signal);
        ctx.progress((++done / files.length) * 0.7);
        return q;
      });
      const bytes = await writeGif([first, ...rest], { delay, loop });
      ctx.progress(1);
      return [{ name: "animation.gif", blob: new Blob([bytes as BlobPart], { type: "image/gif" }), width: frame.width, height: frame.height }];
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
