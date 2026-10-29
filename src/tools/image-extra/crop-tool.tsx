import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { decodeImage } from "../../lib/image/decode";
import { encodeCanvas } from "../../lib/image/encode";
import { FORMATS, sameFormat, type ImageFormat } from "../../lib/image/formats";
import {
  HANDLES,
  centerCrop,
  clampMove,
  cropFor,
  editField,
  parseRatio,
  resizeRect,
  roundRect,
  toFrac,
  type BatchMode,
  type Handle,
  type Rect,
} from "../../lib/image-extra/crop";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Field, NumberField, Segmented, Slider, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { ItemPicker, RASTER_ACCEPT, RASTER_FORMATS, usePreview, useSelection } from "./shared";
import { s } from "./strings";

const ASPECTS = ["free", "1:1", "4:3", "3:2", "16:9", "9:16", "4:5", "2:3", "custom"] as const;
type AspectKey = (typeof ASPECTS)[number];
type OutFormat = "same" | "png" | "jpg" | "webp" | "avif";
const OUT_FORMATS: OutFormat[] = ["same", "png", "jpg", "webp", "avif"];

const pct = (v: number) => `${v * 100}%`;

const HANDLE_STYLE: Record<Handle, { left: string; top: string; cursor: string }> = {
  nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
  n: { left: "50%", top: "0%", cursor: "ns-resize" },
  ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
  e: { left: "100%", top: "50%", cursor: "ew-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" },
  s: { left: "50%", top: "100%", cursor: "ns-resize" },
  sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
  w: { left: "0%", top: "50%", cursor: "ew-resize" },
};

/** The image with a draggable, resizable crop box over it. */
function CropBox({ url, W, H, rect, aspect, onChange }: { url: string; W: number; H: number; rect: Rect; aspect: number | null; onChange: (r: Rect) => void }) {
  const t = useT(s);
  const wrap = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);

  // Show the image as large as the panel allows (small images are scaled up, big ones down).
  useLayoutEffect(() => {
    const el = outer.current!;
    const measure = () => {
      const k = Math.min((el.clientWidth - 24) / W, Math.min(window.innerHeight * 0.68, 640) / H);
      setFit({ w: Math.max(1, Math.floor(W * k)), h: Math.max(1, Math.floor(H * k)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  const drag = (handle: Handle | "move") => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (handle === "move") e.currentTarget.focus();
    const box = wrap.current!.getBoundingClientRect();
    const kx = W / box.width;
    const ky = H / box.height;
    const start = rect;
    const [sx, sy] = [e.clientX, e.clientY];
    const min = Math.min(16 * kx, W, H); // never smaller than ~16 screen px
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) * kx;
      const dy = (ev.clientY - sy) * ky;
      onChange(handle === "move" ? clampMove({ ...start, x: start.x + dx, y: start.y + dy }, W, H) : resizeRect(start, handle, dx, dy, aspect, W, H, min));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const nudge = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    const r = roundRect(rect, W, H);
    onChange(clampMove({ ...r, x: r.x + d[0], y: r.y + d[1] }, W, H));
  };

  const [x, y, w, h] = [rect.x / W, rect.y / H, rect.w / W, rect.h / H];
  const dim = "pointer-events-none absolute bg-black/55";
  return (
    <div ref={outer} className="flex min-w-0 justify-center px-3 py-3">
      <div ref={wrap} className="relative touch-none select-none" style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }}>
        <img src={url} alt="" draggable={false} className="block size-full rounded-sm" />
        <span id={hintId} className="sr-only">
          {t("cropHint")}
        </span>
        <div className={dim} style={{ left: 0, top: 0, right: 0, height: pct(y) }} />
        <div className={dim} style={{ left: 0, top: pct(y + h), right: 0, bottom: 0 }} />
        <div className={dim} style={{ left: 0, top: pct(y), width: pct(x), height: pct(h) }} />
        <div className={dim} style={{ left: pct(x + w), top: pct(y), right: 0, height: pct(h) }} />
        <div
          role="group"
          tabIndex={0}
          aria-label={t("cropArea")}
          aria-describedby={hintId}
          data-testid="crop-box"
          onPointerDown={drag("move")}
          onKeyDown={nudge}
          className="absolute cursor-move outline-none ring-accent ring-offset-0 focus-visible:ring-2"
          style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h) }}
        >
          <div className="pointer-events-none absolute inset-0 border border-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.35)]" />
          {[1 / 3, 2 / 3].map((f) => (
            <span key={`v${f}`} className="pointer-events-none absolute inset-y-0 w-px bg-white/45" style={{ left: pct(f) }} />
          ))}
          {[1 / 3, 2 / 3].map((f) => (
            <span key={`h${f}`} className="pointer-events-none absolute inset-x-0 h-px bg-white/45" style={{ top: pct(f) }} />
          ))}
          {HANDLES.map((hd) => (
            <span
              key={hd}
              data-handle={hd}
              onPointerDown={drag(hd)}
              className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={HANDLE_STYLE[hd]}
            >
              <span className={cx("rounded-[3px] border border-black/30 bg-white shadow", hd.length === 2 ? "size-3" : hd === "n" || hd === "s" ? "h-1.5 w-4" : "h-4 w-1.5")} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CropTool({ meta }: EngineProps) {
  const t = useT(s);
  const preset = (meta.preset ?? {}) as { aspect?: AspectKey };
  const queue = useQueue();
  const [item, select] = useSelection(queue);
  const { preview, error } = usePreview(item?.file);
  const [aspectKey, setAspectKey] = useState<AspectKey>(preset.aspect ?? "free");
  const [custom, setCustom] = useState({ w: 5, h: 4 });
  const [mode, setMode] = useState<BatchMode>("same");
  const [shared, setShared] = useState<Rect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [own, setOwn] = useState<Record<string, Rect>>({});
  const [format, setFormat] = useState<OutFormat>("same");
  const [quality, setQuality] = useState(90);

  const n = queue.items.length;
  const batchMode: BatchMode = n > 1 ? mode : "same";
  const ratioOf = (key: AspectKey, c = custom) => (key === "free" ? null : key === "custom" ? (c.w > 0 && c.h > 0 ? c.w / c.h : null) : parseRatio(key));
  const aspect = ratioOf(aspectKey);
  const W = preview?.width ?? 0;
  const H = preview?.height ?? 0;
  const rect = item && W ? cropFor(batchMode, shared, own[item.id], aspect, W, H) : null;
  const shown = rect ? roundRect(rect, W, H) : null;

  const setRect = (r: Rect) => {
    if (!item || !W) return;
    if (batchMode === "center") setOwn((o) => ({ ...o, [item.id]: toFrac(r, W, H) }));
    else setShared(toFrac(r, W, H));
  };

  /** New aspect: the largest centred crop of it; individual adjustments are dropped. */
  const changeAspect = (key: AspectKey, c = custom) => {
    const a = ratioOf(key, c);
    setAspectKey(key);
    setOwn({});
    if (W && (a || rect)) setShared(toFrac(a ? centerCrop(W, H, a) : rect!, W, H));
  };

  const changeMode = (m: BatchMode) => {
    setMode(m);
    setOwn({});
    if (m === "center" && !aspect) changeAspect("1:1");
  };

  const reset = () => {
    if (!item || !W) return;
    if (batchMode === "center")
      setOwn((o) => {
        const next = { ...o };
        delete next[item.id];
        return next;
      });
    else setShared(toFrac(centerCrop(W, H, aspect), W, H));
  };

  const lossy = format === "same" ? queue.items.some((it) => FORMATS[sameFormat(it.file)].lossy) : FORMATS[format].lossy;

  const run = () => {
    const ids = new Map(queue.items.map((it) => [it.file, it.id]));
    const heavy = format === "avif" || (format === "same" && queue.items.some((it) => sameFormat(it.file) === "avif"));
    return queue.runEach(async (file, ctx) => {
      const img = await decodeImage(file);
      try {
        ctx.progress(0.4);
        const r = roundRect(cropFor(batchMode, shared, own[ids.get(file) ?? ""], aspect, img.width, img.height), img.width, img.height);
        const fmt: ImageFormat = format === "same" ? sameFormat(file) : format;
        const canvas = document.createElement("canvas");
        canvas.width = r.w;
        canvas.height = r.h;
        const g = canvas.getContext("2d")!;
        if (!FORMATS[fmt].alpha) {
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, r.w, r.h);
        }
        g.drawImage(img.source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const blob = await encodeCanvas(canvas, fmt, { quality, lossless: false, pngColors: 0, icoSizes: [] });
        canvas.width = canvas.height = 0;
        return { name: `${splitName(file.name).base}-cropped.${FORMATS[fmt].ext}`, blob, width: r.w, height: r.h };
      } finally {
        img.close();
      }
    }, heavy ? 1 : 2);
  };

  const editor = item ? (
    <section className="min-w-0 rounded-2xl border border-line bg-surface">
      <header className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="truncate text-sm font-semibold" title={item.file.name}>
            {t("cropArea")} <span className="font-normal text-muted">· {item.file.name}</span>
          </h2>
          {shown ? (
            <span className="shrink-0 font-mono text-xs text-muted tabular-nums" data-testid="crop-size">
              {shown.w}×{shown.h}
            </span>
          ) : null}
        </div>
        <ItemPicker items={queue.items} selected={item.id} onSelect={select} marked={(id) => batchMode === "center" && id in own} />
      </header>
      {preview && rect ? (
        <CropBox url={preview.url} W={W} H={H} rect={rect} aspect={aspect} onChange={setRect} />
      ) : (
        <div className="flex min-h-48 items-center justify-center gap-2 p-6 text-sm text-muted">
          {error ? (
            <span className="text-err">{t("cantPreview")}</span>
          ) : (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("loadingImage")}
            </>
          )}
        </div>
      )}
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{t("cropHint")}</p>
    </section>
  ) : null;

  const field = (key: keyof Rect, label: string) => (
    <NumberField
      label={label}
      value={shown ? shown[key] : null}
      onChange={(v) => v !== null && rect && setRect(editField(rect, key, v, aspect, W, H))}
      suffix="px"
      min={key === "w" || key === "h" ? 1 : 0}
    />
  );

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <FileInput queue={queue} accept={RASTER_ACCEPT} formats={RASTER_FORMATS} />
          {editor}
        </div>
      }
      settings={
        <>
          <Field label={t("aspect")}>
            <div role="radiogroup" aria-label={t("aspect")} className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
              {ASPECTS.map((key) => {
                const disabled = key === "free" && batchMode === "center";
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={aspectKey === key}
                    disabled={disabled}
                    onClick={() => changeAspect(key)}
                    className={cx(
                      "h-8 min-w-0 truncate rounded-lg border px-2 text-xs font-medium transition disabled:opacity-35",
                      key !== "free" && key !== "custom" && "font-mono",
                      aspectKey === key ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg",
                    )}
                  >
                    {key === "free" ? t("free") : key === "custom" ? t("custom") : key}
                  </button>
                );
              })}
            </div>
            {aspectKey === "custom" ? (
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <NumberField label={t("ratioW")} value={custom.w} min={0.01} onChange={(v) => v && v > 0 && (setCustom({ ...custom, w: v }), changeAspect("custom", { ...custom, w: v }))} />
                <span className="pb-2 text-muted">:</span>
                <NumberField label={t("ratioH")} value={custom.h} min={0.01} onChange={(v) => v && v > 0 && (setCustom({ ...custom, h: v }), changeAspect("custom", { ...custom, h: v }))} />
              </div>
            ) : null}
          </Field>
          {n > 1 ? (
            <Field label={t("batch")} hint={batchMode === "center" ? t("batchCenterHint") : t("batchSameHint")}>
              <Segmented<BatchMode>
                label={t("batch")}
                value={batchMode}
                onChange={changeMode}
                columns={2}
                size="sm"
                options={[
                  { value: "same", label: t("batchSame") },
                  { value: "center", label: t("batchCenter") },
                ]}
              />
            </Field>
          ) : null}
          <Field label={t("position")} hint={t("pxHint")}>
            <div className="grid grid-cols-2 gap-2">
              {field("x", t("x"))}
              {field("y", t("y"))}
              {field("w", t("width"))}
              {field("h", t("height"))}
            </div>
            <Button size="sm" variant="ghost" onClick={reset} disabled={!rect} className="self-start">
              <RotateCcw className="size-3.5" />
              {batchMode === "center" ? t("recenter") : t("reset")}
            </Button>
          </Field>
          <Field label={t("format")} hint={format === "same" ? t("sameHint") : undefined}>
            <Segmented<OutFormat>
              label={t("format")}
              value={format}
              onChange={setFormat}
              columns={5}
              size="sm"
              options={OUT_FORMATS.map((f) => ({ value: f, label: f === "same" ? t("same") : FORMATS[f].label }))}
            />
          </Field>
          {lossy ? <Slider label={t("quality")} value={quality} onChange={setQuality} min={1} max={100} suffix="%" marks={[t("smaller"), t("better")]} /> : null}
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("cropRunN", { n }) : t("cropRun")} disabled={!aspect && aspectKey === "custom"} />}
      results={<Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
