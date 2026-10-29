import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { EngineProps } from "../../engines";
import { formatBytes, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { PRESETS, type TracePreset, type TraceSettings } from "../../lib/image-extra/trace";
import { loadSource, pixelsAt, traceIn, tracePool, type Source } from "../../lib/image-extra/trace-client";
import { poolSize } from "../../lib/image-extra/worker-pool";
import { useObjectUrl } from "../../lib/use-object-url";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, Slider, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { ItemPicker, RASTER_ACCEPT, RASTER_FORMATS, usePreview, useSelection } from "./shared";
import { s } from "./strings";

const PRESET_KEYS: TracePreset[] = ["detailed", "posterized", "smooth", "lineart", "pixel"];
const SIZES = [500, 1000, 2000];
/** The live preview never traces bigger than this (the default output size). */
const PREVIEW_MAX = 1000;

// One decoded copy per file for the live preview, so tweaking settings doesn't re-decode.
const sources = new WeakMap<File, Promise<Source>>();
function previewSource(file: File): Promise<Source> {
  let p = sources.get(file);
  if (!p) {
    p = loadSource(file, PREVIEW_MAX);
    p.catch(() => sources.delete(file));
    sources.set(file, p);
  }
  return p;
}

interface Live {
  file: File;
  blob: Blob;
  paths: number;
}

function Pane({ label, url, busy, footer }: { label: string; url: string | null; busy?: boolean; footer?: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
        <span>{label}</span>
        {footer ? <span className="font-mono tabular-nums">{footer}</span> : null}
      </figcaption>
      <div className="checker relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-line">
        {url ? <img src={url} alt={label} className="size-full object-contain" /> : null}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-surface/40 backdrop-blur-[1px]">
            <Loader2 className="size-5 animate-spin text-accent-text" />
          </span>
        ) : null}
      </div>
    </figure>
  );
}

export default function SvgTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [item, select] = useSelection(queue);
  const { preview } = usePreview(item?.file);
  const [st, setSt] = useState<TraceSettings>({ preset: "posterized", size: 1000, ...PRESETS.posterized });
  const set = (p: Partial<TraceSettings>) => setSt((x) => ({ ...x, ...p }));
  const [pools] = useState(() => ({ batch: tracePool(poolSize()), preview: tracePool(1) }));
  const [live, setLive] = useState<Live | null>(null);
  const [tracing, setTracing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgUrl = useObjectUrl(live && live.file === item?.file ? live.blob : null);
  const seq = useRef(0);

  // Load the tracer in the background so the first trace doesn't wait for it.
  useEffect(() => {
    pools.preview.warm();
    return () => {
      pools.batch.terminate();
      pools.preview.terminate();
    };
  }, [pools]);

  // Live preview: debounced; a newer request cancels (terminates) the running trace.
  const file = item?.file;
  useEffect(() => {
    if (!file) return;
    const ctrl = new AbortController();
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setTracing(true);
      setError(null);
      try {
        const ps = { ...st, size: Math.min(st.size, PREVIEW_MAX) };
        const src = await previewSource(file);
        const r = await traceIn(pools.preview, pixelsAt(src, ps), src.width, src.height, ps, ctrl.signal);
        if (id === seq.current) setLive({ file, blob: new Blob([r.svg], { type: "image/svg+xml" }), paths: r.paths });
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === seq.current) setTracing(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [file, st, pools]);

  const run = () =>
    queue.runEach(async (f, ctx) => {
      const src = await loadSource(f, st.size);
      ctx.progress(0.15);
      const r = await traceIn(pools.batch, pixelsAt(src, st), src.width, src.height, st, ctx.signal);
      return {
        name: withExt(f.name, "svg"),
        blob: new Blob([r.svg], { type: "image/svg+xml" }),
        width: src.width,
        height: src.height,
        note: t("shapes", { n: r.paths }),
      };
    }, pools.batch.size);

  const presetOptions = PRESET_KEYS.map((p) => ({ value: p, label: t(p) }));
  const n = queue.items.length;
  const current = live && live.file === file ? live : null;

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <FileInput queue={queue} accept={RASTER_ACCEPT} formats={RASTER_FORMATS} />
          {item ? (
            <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4" data-testid="svg-preview">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h2 className="truncate text-sm font-semibold">
                  {t("preview")} <span className="font-normal text-muted">· {item.file.name}</span>
                </h2>
                {tracing ? <span className="shrink-0 text-xs text-muted">{t("tracing")}</span> : null}
              </div>
              <ItemPicker items={queue.items} selected={item.id} onSelect={select} />
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Pane label={t("original")} url={preview?.url ?? null} footer={preview ? `${preview.width}×${preview.height}` : undefined} />
                <Pane
                  label="SVG"
                  url={svgUrl}
                  busy={tracing}
                  footer={current ? `${t("shapes", { n: current.paths })} · ${formatBytes(current.blob.size)}` : undefined}
                />
              </div>
              {error ? <p className="text-xs text-err">{error}</p> : null}
            </section>
          ) : null}
        </div>
      }
      settings={
        <>
          <Field label={t("style")}>
            <Segmented<TracePreset> label={t("style")} value={st.preset} onChange={(preset) => set({ preset, ...PRESETS[preset] })} options={presetOptions} columns={2} size="sm" />
          </Field>
          <Slider label={st.preset === "lineart" ? t("shades") : t("colors")} value={st.colors} onChange={(colors) => set({ colors })} min={2} max={64} />
          <Slider label={t("blur")} value={st.blur} onChange={(blur) => set({ blur })} min={0} max={5} />
          <div className="flex flex-col gap-1.5">
            <Slider label={t("omit")} value={st.omit} onChange={(omit) => set({ omit })} min={0} max={64} />
            <p className="text-xs leading-relaxed text-muted">{t("omitHint")}</p>
          </div>
          <Switch checked={st.removeBg} onChange={(removeBg) => set({ removeBg })} label={t("removeBg")} hint={t("removeBgHint")} />
          <Field label={t("resolution")} hint={t("resolutionHint")}>
            <Segmented<number> label={t("resolution")} value={st.size} onChange={(size) => set({ size })} columns={3} size="sm" options={SIZES.map((v) => ({ value: v, label: `${v} px` }))} />
          </Field>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("svgRunN", { n }) : t("svgRun")} />}
      results={<Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
