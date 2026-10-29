import { useEffect, useRef, useState } from "react";
import type { EngineProps } from "../../engines";
import { formatBytes, splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { decodeImage } from "../../lib/image/decode";
import { canvasToBlob, ctx2d, encodeCanvas, makeCanvas } from "../../lib/image/encode";
import { MODEL } from "../../lib/ml/rembg";
import { composite, modelCached, modelStatus, releaseModel, subjectMask, warmModel, type Backdrop } from "../../lib/ml/rembg-engine";
import { useObjectUrl } from "../../lib/use-object-url";
import { useQueue, type Output } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { ColorField, Field, Segmented, Slider, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { EngineLine, IMAGE_INPUT, IMAGE_LABEL, bytesOf, useStore } from "./common";
import { s } from "./strings";

type Kind = Backdrop["kind"];
type Format = "png" | "webp";

/** Small copy of the original for the before/after slider (any input format, EXIF-upright). */
async function beforePreview(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const k = Math.min(1, 1600 / Math.max(width, height));
  const c = makeCanvas(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
  const g = ctx2d(c);
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, c.width, c.height);
  return canvasToBlob(c, "image/webp", 0.85);
}

/** Before/after slider over a checkerboard. */
function Compare({ before, after }: { before: Blob; after: Blob }) {
  const t = useT(s);
  const b = useObjectUrl(before);
  const a = useObjectUrl(after);
  const [pos, setPos] = useState(50);
  if (!a || !b) return null;
  return (
    <div className="checker relative w-full overflow-hidden rounded-xl border border-line select-none" data-testid="compare">
      <img src={a} alt={t("after")} className="mx-auto block h-auto max-h-[60vh] w-full object-contain" draggable={false} />
      <img
        src={b}
        alt={t("before")}
        className="pointer-events-none absolute inset-0 size-full object-contain"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)]" style={{ left: `${pos}%` }} />
      <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">{t("before")}</span>
      <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">{t("after")}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={t("compare")}
        className="absolute inset-0 size-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}

function ModelLine({ cached }: { cached: boolean }) {
  const t = useT(s);
  const st = useStore(modelStatus);
  if (st.phase === "idle") return cached ? null : <EngineLine phase="ready" text={t("modelNotCached", { size: formatBytes(MODEL.bytes) })} />;
  if (st.phase === "download") return <EngineLine phase="busy" text={t("modelDownload", bytesOf(st.loaded, st.total))} progress={st.total ? st.loaded / st.total : 0} />;
  if (st.phase === "starting") return <EngineLine phase="busy" text={t("modelStarting")} />;
  if (st.phase === "error") return <EngineLine phase="error" text={t("modelError", { error: st.error ?? "" })} />;
  return <EngineLine phase="ready" text={t("modelReady", { backend: st.backend ?? "" })} />;
}

export default function RemoveBgTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [kind, setKind] = useState<Kind>("transparent");
  const [color, setColor] = useState("#ffffff");
  const [blur, setBlur] = useState(8);
  const [format, setFormat] = useState<Format>("png");
  const [feather, setFeather] = useState(0);
  const [sharpen, setSharpen] = useState(false);
  const [cached, setCached] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const status = useStore(modelStatus);
  // Output blob → small "before" image for the comparison slider.
  const befores = useRef(new WeakMap<Blob, Blob>());
  const n = queue.items.length;

  // Warm-up: start the model if it's already cached. An 88 MB first download waits for the
  // first click instead, so just opening the page never costs a phone its data.
  useEffect(() => {
    let alive = true;
    void modelCached().then((c) => alive && setCached(c));
    void warmModel();
    return () => {
      alive = false;
      releaseModel();
    };
  }, []);

  const run = () => {
    const backdrop: Backdrop = kind === "color" ? { kind, color } : kind === "blur" ? { kind, amount: blur } : { kind };
    return queue.runEach(async (file, ctx) => {
      const img = await decodeImage(file);
      try {
        ctx.progress(0.05);
        const alpha = await subjectMask(file, img.source, ctx.signal);
        ctx.signal.throwIfAborted();
        ctx.progress(0.75);
        const canvas = composite(img.source, img.width, img.height, alpha, MODEL.size, { sharpen, feather }, backdrop);
        const blob = await encodeCanvas(canvas, format, { quality: 90, lossless: false, pngColors: 0, icoSizes: [] });
        befores.current.set(blob, await beforePreview(img.source, img.width, img.height));
        const { width, height } = canvas;
        canvas.width = canvas.height = 0;
        return { name: `${splitName(file.name).base}-${kind === "mask" ? "mask" : "no-bg"}.${format}`, blob, width, height };
      } finally {
        img.close();
      }
    }, 2);
  };

  const current: Output | undefined = queue.outputs.find((o) => o.id === selected) ?? queue.outputs[0];
  const before = current ? befores.current.get(current.blob) : undefined;
  const loading =
    status.phase === "download" ? t("modelDownload", bytesOf(status.loaded, status.total)) : status.phase === "starting" ? t("modelStarting") : null;

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={IMAGE_INPUT} formats={IMAGE_LABEL} />}
      settings={
        <>
          <Field label={t("model")} hint={t("modelHint", { size: formatBytes(MODEL.bytes) })}>
            <ModelLine cached={cached} />
          </Field>
          <Field label={t("background")}>
            <Segmented<Kind>
              label={t("background")}
              value={kind}
              onChange={setKind}
              size="sm"
              columns={2}
              options={[
                { value: "transparent", label: t("bgTransparent") },
                { value: "color", label: t("bgColor") },
                { value: "blur", label: t("bgBlur") },
                { value: "mask", label: t("bgMask") },
              ]}
            />
            {kind === "color" ? <ColorField label={t("bgColorLabel")} value={color} onChange={setColor} /> : null}
            {kind === "blur" ? <Slider label={t("blurAmount")} value={blur} onChange={setBlur} min={1} max={20} /> : null}
          </Field>
          <Field label={t("format")}>
            <Segmented<Format>
              label={t("format")}
              value={format}
              onChange={setFormat}
              size="sm"
              columns={2}
              options={[
                { value: "png", label: "PNG" },
                { value: "webp", label: "WebP" },
              ]}
            />
          </Field>
          <Field label={t("edges")}>
            <Slider label={t("feather")} value={feather} onChange={setFeather} min={0} max={10} />
            <Switch checked={sharpen} onChange={setSharpen} label={t("sharpen")} hint={t("sharpenHint")} />
          </Field>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("rembgRunN", { n }) : t("rembgRun")} status={loading} />}
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {current && before ? (
            <div className="flex min-w-0 flex-col gap-3">
              <h3 className="text-[13px] font-medium">{t("preview")}</h3>
              {queue.outputs.length > 1 ? (
                <Segmented label={t("preview")} value={current.id} onChange={setSelected} size="sm" options={queue.outputs.map((o) => ({ value: o.id, label: o.name, title: o.name }))} />
              ) : null}
              <Compare before={before} after={current.blob} />
            </div>
          ) : null}
        </Results>
      }
    />
  );
}
