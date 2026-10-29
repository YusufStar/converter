import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Columns2, Loader2, X } from "lucide-react";
import { formatBytes } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { DEFAULT_IMAGE_OPTIONS } from "../../lib/image/convert";
import { runJob } from "../../lib/image/pool";
import { useObjectUrl } from "../../lib/use-object-url";
import type { Output } from "../../lib/use-queue";
import { Button, IconButton, Segmented, cx } from "../../ui/kit";
import { s } from "./strings";

// What an <img> shows everywhere; anything else (HEIC, TIFF, PSD, RAW, JXL…) is turned into a PNG first.
const SHOWABLE = /^image\/(png|jpeg|webp|avif|gif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;

/** Object URL of an image the browser can show: the blob itself, or a PNG rendered from it in the image pool. */
function usePreviewUrl(blob: Blob | undefined, name: string): string | null {
  const [shown, setShown] = useState<Blob | null>(null);
  useEffect(() => {
    setShown(null);
    if (!blob) return;
    if (SHOWABLE.test(blob.type)) return setShown(blob);
    const ctrl = new AbortController();
    const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type });
    runJob("convert", file, [{ ...DEFAULT_IMAGE_OPTIONS, format: "png" }], DEFAULT_IMAGE_OPTIONS.resize, ctrl.signal).then(
      (r) => setShown(r.blob),
      () => {},
    );
    return () => ctrl.abort();
  }, [blob, name]);
  return useObjectUrl(shown);
}

type Zoom = "fit" | "actual";

function CompareView({ output, source }: { output: Output; source?: File }) {
  const t = useT(s);
  const before = usePreviewUrl(source, source?.name ?? "");
  const after = usePreviewUrl(output.blob, output.name);
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [outSize, setOutSize] = useState<{ width: number; height: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const w = output.width ?? outSize?.width ?? 1;
  const h = output.height ?? outSize?.height ?? 1;

  const moveTo = (clientX: number) => {
    const r = stage.current!.getBoundingClientRect();
    setPos(Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)) * 10) / 10);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const next: Record<string, number> = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, PageDown: pos - 10, PageUp: pos + 10, Home: 0, End: 100 };
    if (!(e.key in next)) return;
    e.preventDefault();
    setPos(Math.min(100, Math.max(0, next[e.key])));
  };

  const img = "pointer-events-none absolute inset-0 size-full object-contain select-none";
  const tag = "pointer-events-none absolute top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white";
  const box = (
    <div
      ref={stage}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      className={cx("checker relative mx-auto shrink-0 cursor-ew-resize overflow-hidden", zoom === "fit" ? "touch-pan-y rounded-lg" : "")}
      style={
        zoom === "fit"
          ? { aspectRatio: `${w} / ${h}`, width: `min(100%, calc(min(65vh, 720px) * ${w / h}))` }
          : { width: w, height: h }
      }
    >
      {after ? <img src={after} alt={t("after")} draggable={false} className={img} onLoad={(e) => setOutSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} /> : null}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {before ? (
          <img
            src={before}
            alt={t("before")}
            draggable={false}
            className={img}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
        ) : (
          <Loader2 className="absolute top-1/2 left-1/4 size-5 -translate-1/2 animate-spin text-muted" aria-label={t("loadingOriginal")} />
        )}
      </div>
      <span className={cx(tag, "left-2")}>{t("before")}</span>
      <span className={cx(tag, "right-2")}>{t("after")}</span>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t("divider")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pos}
        aria-valuetext={`${Math.round(pos)}%`}
        onKeyDown={onKey}
        className="group absolute inset-y-0 w-8 -translate-x-1/2 touch-none outline-none"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)]" />
        <span className="absolute top-1/2 left-1/2 flex size-8 -translate-1/2 items-center justify-center rounded-full border border-line bg-surface text-fg shadow-md group-focus-visible:ring-2 group-focus-visible:ring-accent">
          <ChevronLeft className="-mr-1 size-3.5" />
          <ChevronRight className="-ml-1 size-3.5" />
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="w-36">
        <Segmented<Zoom>
          label={t("zoom")}
          value={zoom}
          onChange={setZoom}
          size="sm"
          options={[
            { value: "fit", label: t("zoomFit") },
            { value: "actual", label: "100%" },
          ]}
        />
      </div>
      {zoom === "fit" ? box : <div className="max-h-[70vh] overflow-auto rounded-lg border border-line">{box}</div>}
      <dl className="grid grid-cols-2 gap-3 text-xs tabular-nums" data-testid="compare-sizes">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="font-medium">{t("before")}</dt>
          <dd className="text-muted">
            {source ? formatBytes(source.size) : "—"}
            {natural ? ` · ${natural.width}×${natural.height}` : ""}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
          <dt className="font-medium">{t("after")}</dt>
          <dd className="text-muted">
            {formatBytes(output.blob.size)} · {w}×{h}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Before/after slider for the image tools, shown inside Results. `selected` is the output id
 * (set by clicking a result row, or the Compare button); `source` maps an output to its input.
 */
export function Compare({
  outputs,
  source,
  selected,
  onSelect,
}: {
  outputs: Output[];
  source: (o: Output) => File | undefined;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useT(s);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);
  // PDFs and other non-images have nothing to slide over.
  const list = outputs.filter((o) => o.blob.type.startsWith("image/") && source(o));
  if (!list.length) return null;
  const i = list.findIndex((o) => o.id === selected);
  if (i < 0)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => onSelect(list[0].id)} data-testid="compare-open">
          <Columns2 className="size-3.5" />
          {t("compare")}
        </Button>
        <span className="text-xs text-muted">{t("compareHint")}</span>
      </div>
    );
  const output = list[i];
  return (
    <section ref={ref} className="flex min-w-0 scroll-mt-20 flex-col gap-3" aria-label={t("compare")} data-testid="compare">
      <header className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={output.name}>
          {output.name}
        </h3>
        {list.length > 1 ? (
          <>
            <IconButton label={t("prev")} onClick={() => onSelect(list[(i - 1 + list.length) % list.length].id)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="text-xs text-muted tabular-nums">
              {i + 1}/{list.length}
            </span>
            <IconButton label={t("next")} onClick={() => onSelect(list[(i + 1) % list.length].id)}>
              <ChevronRight className="size-4" />
            </IconButton>
          </>
        ) : null}
        <IconButton label={t("closeCompare")} onClick={() => onSelect(null)}>
          <X className="size-4" />
        </IconButton>
      </header>
      <CompareView key={output.id} output={output} source={source(output)} />
    </section>
  );
}

/**
 * Click handler for a wrapper around <Results>: a click on a result row (not on its
 * buttons) picks that output for the comparison.
 */
export function pickResultRow(e: { target: EventTarget }, outputs: Output[], onSelect: (id: string) => void) {
  const el = e.target as HTMLElement;
  if (el.closest("button, a")) return;
  const li = el.closest("[data-testid=results] > ul > li");
  if (!li?.parentElement) return;
  const o = outputs[Array.prototype.indexOf.call(li.parentElement.children, li)];
  if (o) onSelect(o.id);
}
