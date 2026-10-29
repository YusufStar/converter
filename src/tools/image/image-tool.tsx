import { useMemo, useState, type ReactNode } from "react";
import { FlipHorizontal2, FlipVertical2, Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { convertImage, DEFAULT_IMAGE_OPTIONS, type ImageOptions, type Rotation } from "../../lib/image/convert";
import { FORMATS, IMAGE_ACCEPT, IMAGE_FORMATS_LABEL, OUTPUT_FORMATS, inputKind, type OutputFormat } from "../../lib/image/formats";
import { ICO_SIZES } from "../../lib/image/ico";
import { DEFAULT_RESIZE, type ResizeMode, type ResizeOptions } from "../../lib/image/resize";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { ColorField, Field, NumberField, Segmented, Slider, Switch, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

interface Preset {
  format?: OutputFormat;
  quality?: number;
  pngColors?: number;
  resize?: Partial<ResizeOptions>;
  svg?: boolean;
  accept?: string;
  focus?: "resize" | "compress" | "transform";
}

export function ResizeSection({ value, onChange, vector }: { value: ResizeOptions; onChange: (r: ResizeOptions) => void; vector: boolean }) {
  const t = useT(s);
  const set = (p: Partial<ResizeOptions>) => onChange({ ...value, ...p });
  const percents = vector ? [100, 200, 300, 400, 800] : [25, 50, 75, 100, 150, 200];
  return (
    <Field label={t("resize")} hint={vector ? t("svgHint") : undefined}>
      <Segmented<ResizeMode>
        label={t("resize")}
        value={value.mode}
        onChange={(mode) => set({ mode })}
        columns={4}
        size="sm"
        options={[
          { value: "original", label: t("original") },
          { value: "percent", label: vector ? t("scale") : t("percent") },
          { value: "dimensions", label: t("dimensions") },
          { value: "longest", label: t("longest") },
        ]}
      />
      {value.mode === "percent" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {percents.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ percent: p })}
                className={cx(
                  "h-7 rounded-lg border px-2.5 font-mono text-xs transition",
                  value.percent === p ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg",
                )}
              >
                {vector ? `${p / 100}×` : `${p}%`}
              </button>
            ))}
          </div>
          <NumberField label={vector ? t("scale") : t("percent")} value={value.percent} onChange={(v) => set({ percent: v ?? 100 })} suffix="%" min={1} max={2000} />
        </div>
      ) : null}
      {value.mode === "dimensions" ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t("width")} value={value.width} onChange={(width) => set({ width })} suffix="px" min={1} placeholder="auto" />
            <NumberField label={t("height")} value={value.height} onChange={(height) => set({ height })} suffix="px" min={1} placeholder="auto" />
          </div>
          <Switch checked={value.keepAspect} onChange={(keepAspect) => set({ keepAspect })} label={t("keepAspect")} hint={t("keepAspectHint")} />
        </div>
      ) : null}
      {value.mode === "longest" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {[640, 1080, 1280, 1920, 2560, 3840].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ longest: p })}
                className={cx(
                  "h-7 rounded-lg border px-2.5 font-mono text-xs transition",
                  value.longest === p ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <NumberField label={t("longest")} value={value.longest} onChange={(v) => set({ longest: v ?? 1920 })} suffix="px" min={1} />
        </div>
      ) : null}
      {value.mode !== "original" && !vector ? <Switch checked={value.noEnlarge} onChange={(noEnlarge) => set({ noEnlarge })} label={t("noEnlarge")} /> : null}
    </Field>
  );
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export default function ImageTool({ meta }: EngineProps) {
  const t = useT(s);
  const preset = (meta.preset ?? {}) as Preset;
  const queue = useQueue();
  const [o, setO] = useState<ImageOptions>(() => ({
    ...DEFAULT_IMAGE_OPTIONS,
    format: preset.format ?? DEFAULT_IMAGE_OPTIONS.format,
    quality: preset.quality ?? DEFAULT_IMAGE_OPTIONS.quality,
    pngColors: preset.pngColors ?? 0,
    resize: { ...DEFAULT_RESIZE, ...preset.resize },
  }));
  const [limit, setLimit] = useState(false);
  const set = (p: Partial<ImageOptions>) => setO((prev) => ({ ...prev, ...p }));

  const hasSvg = preset.svg || queue.items.some((it) => inputKind(it.file) === "svg");
  const allSvg = preset.svg || (queue.items.length > 0 && queue.items.every((it) => inputKind(it.file) === "svg"));
  const fmt = o.format;
  const info = fmt === "same" ? null : FORMATS[fmt];
  const showQuality = fmt === "same" || (info?.lossy ?? false);
  const showPng = fmt === "png" || fmt === "same";
  const canLossless = fmt === "webp" || fmt === "avif";
  const canTarget = fmt !== "gif" && fmt !== "bmp" && fmt !== "tiff" && fmt !== "ico";
  const noAlpha = info ? !info.alpha : false;

  const formatOptions = useMemo(
    () => [
      ...(preset.format === "same" ? [{ value: "same" as OutputFormat, label: t("same"), title: t("sameHint") }] : []),
      ...OUTPUT_FORMATS.map((f) => ({ value: f as OutputFormat, label: FORMATS[f].label })),
    ],
    [preset.format, t],
  );

  const sections: Record<string, ReactNode> = {
    format: (
      <Field key="format" label={t("format")} hint={fmt === "same" ? t("sameHint") : undefined}>
        <Segmented label={t("format")} value={fmt} onChange={(format) => set({ format })} options={formatOptions} columns={5} size="sm" />
      </Field>
    ),
    quality:
      showQuality || showPng ? (
        <div key="quality" className="flex flex-col gap-4">
          {showQuality ? (
            <>
              {canLossless ? <Switch checked={o.lossless} onChange={(lossless) => set({ lossless })} label={t("lossless")} hint={t("losslessHint")} /> : null}
              {!(canLossless && o.lossless) ? (
                <Slider label={t("quality")} value={o.quality} onChange={(quality) => set({ quality })} min={1} max={100} suffix="%" marks={[t("smaller"), t("better")]} />
              ) : null}
            </>
          ) : null}
          {showPng ? (
            <Field label={t("pngMode")}>
              <Segmented
                label={t("pngMode")}
                value={o.pngColors ? "smart" : "lossless"}
                onChange={(v) => set({ pngColors: v === "smart" ? 256 : 0 })}
                options={[
                  { value: "lossless", label: t("pngLossless") },
                  { value: "smart", label: t("pngSmart") },
                ]}
                size="sm"
              />
              {o.pngColors ? <Slider label={t("colors")} value={o.pngColors} onChange={(pngColors) => set({ pngColors })} min={2} max={256} /> : null}
            </Field>
          ) : null}
          {canTarget ? (
            <div className="flex flex-col gap-2">
              <Switch checked={limit} onChange={setLimit} label={t("limitSize")} hint={t("limitSizeHint")} />
              {limit ? <NumberField label={t("targetKB")} value={o.targetKB} onChange={(targetKB) => set({ targetKB })} suffix="KB" min={1} placeholder="200" /> : null}
            </div>
          ) : null}
        </div>
      ) : null,
    ico:
      fmt === "ico" ? (
        <Field key="ico" label={t("icoSizes")}>
          <div className="flex flex-wrap gap-1.5">
            {ICO_SIZES.map((size) => {
              const on = o.icoSizes.includes(size);
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ icoSizes: on ? o.icoSizes.filter((x) => x !== size) : [...o.icoSizes, size] })}
                  className={cx("h-7 rounded-lg border px-2.5 font-mono text-xs transition", on ? "border-accent bg-accent-soft" : "border-line text-muted")}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null,
    resize: <ResizeSection key="resize" value={o.resize} onChange={(resize) => set({ resize })} vector={allSvg} />,
    background: (
      <Field key="bg" label={t("background")} hint={noAlpha && info ? t("bgForced", { format: info.label }) : undefined}>
        {noAlpha ? (
          <ColorField label={t("color")} value={o.background ?? "#ffffff"} onChange={(background) => set({ background })} />
        ) : (
          <>
            <Switch checked={o.background !== null} onChange={(on) => set({ background: on ? "#ffffff" : null })} label={t("fillBg")} />
            {o.background !== null ? <ColorField label={t("color")} value={o.background} onChange={(background) => set({ background })} /> : null}
          </>
        )}
      </Field>
    ),
    transform: (
      <Field key="transform" label={t("transform")}>
        <Segmented<Rotation> label={t("rotate")} value={o.rotate} onChange={(rotate) => set({ rotate })} columns={4} size="sm" options={ROTATIONS.map((r) => ({ value: r, label: `${r}°` }))} />
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["flipH", FlipHorizontal2],
              ["flipV", FlipVertical2],
            ] as const
          ).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={o[key]}
              onClick={() => set({ [key]: !o[key] })}
              className={cx(
                "flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition",
                o[key] ? "border-accent bg-accent-soft" : "border-line text-muted hover:text-fg",
              )}
            >
              <Icon className="size-3.5" />
              {t(key)}
            </button>
          ))}
        </div>
      </Field>
    ),
  };

  const order =
    preset.focus === "resize"
      ? ["resize", "format", "quality", "ico", "background", "transform"]
      : preset.focus === "compress"
        ? ["quality", "format", "resize", "ico", "background", "transform"]
        : preset.focus === "transform"
          ? ["transform", "format", "quality", "ico", "resize", "background"]
          : ["format", "quality", "ico", "resize", "background", "transform"];

  const run = () => {
    const opts: ImageOptions = { ...o, targetKB: limit ? o.targetKB : null };
    // AVIF/lossless WebP run in WebAssembly and are memory hungry: one at a time.
    const heavy = fmt === "avif" || (fmt === "webp" && o.lossless);
    return queue.runEach(async (file) => {
      const r = await convertImage(file, opts);
      return { name: r.name, blob: r.blob, width: r.width, height: r.height, note: r.targetMissed ? t("targetMissed") : undefined };
    }, heavy ? 1 : 3);
  };

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={preset.accept ?? (preset.svg ? ".svg,image/svg+xml" : IMAGE_ACCEPT)} formats={preset.svg ? "SVG" : IMAGE_FORMATS_LABEL} />}
      settings={
        <>
          {order.map((k) => sections[k])}
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("stripMeta")} {hasSvg ? "" : t("firstFrame")}
            </span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("convertN", { n }) : t("convertOne")} disabled={limit && !o.targetKB} />}
      results={<Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
