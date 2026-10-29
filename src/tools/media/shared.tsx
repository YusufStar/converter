import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Flag, FlagTriangleRight, Info } from "lucide-react";
import { formatBytes } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { formatTime, isAudioFile, parseRange } from "../../lib/media/args";
import { CORE_BYTES, engineReady, runFFmpeg, type Plan, type RunResult } from "../../lib/media/ffmpeg";
import type { OutputInit, Output, Queue } from "../../lib/use-queue";
import { Button, Field, IconButton, TextField } from "../../ui/kit";
import { s } from "./strings";

type PlanFn = Parameters<typeof runFFmpeg>[1];
export type { Plan };

const MB = 1024 * 1024;

/**
 * Runs the queue one file at a time through ffmpeg (one wasm worker), with a
 * status line for the one-time engine download and "file i of n".
 */
export function useMediaRun(queue: Queue) {
  const t = useT(s);
  const [loading, setLoading] = useState<number | null>(null);
  const [index, setIndex] = useState(0);

  const run = (task: (file: File, exec: (plan: PlanFn) => Promise<RunResult>) => Promise<OutputInit | OutputInit[]>) => {
    let i = 0;
    if (!engineReady()) setLoading(0);
    return queue.runEach(async (file, ctx) => {
      setIndex(++i);
      try {
        return await task(file, (plan) =>
          runFFmpeg(file, plan, {
            signal: ctx.signal,
            // Re-render once per MB, not per network chunk.
            onLoading: (b) => setLoading((prev) => (prev !== null && Math.floor(prev / MB) === Math.floor(b / MB) && b < CORE_BYTES ? prev : b)),
            onProgress: (p) => {
              setLoading(null);
              ctx.progress(p);
            },
          }),
        );
      } finally {
        setLoading(null);
      }
    }, 1);
  };

  const n = queue.items.length;
  const status =
    loading !== null
      ? loading >= CORE_BYTES
        ? t("starting")
        : t("loading", { got: Math.floor(loading / MB), total: Math.round(CORE_BYTES / MB) })
      : n > 1
        ? t("fileOf", { i: index, n, pct: Math.round(queue.progress * 100) })
        : null;
  return { run, status };
}

export interface RangeText {
  start: string;
  end: string;
}

/** Start + end (or start + length) time inputs with inline validation. */
export function TrimFields({ value, onChange, isLength = false, required = false }: { value: RangeText; onChange: (v: RangeText) => void; isLength?: boolean; required?: boolean }) {
  const t = useT(s);
  const { error } = parseRange(value.start, value.end, isLength);
  const message = error === "invalid" ? t("timeInvalid") : error === "order" ? t(isLength ? "lengthZero" : "endBeforeStart") : null;
  return (
    <Field label={t("trim")} hint={message ? <span className="text-err">{message}</span> : t(isLength ? "lengthHint" : required ? "trimHint" : "timeHint")}>
      <div className="grid grid-cols-2 gap-2">
        <TextField label={t("start")} value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} placeholder="0:00" inputMode="decimal" aria-invalid={!!error} />
        <TextField
          label={t(isLength ? "length" : "end")}
          value={value.end}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          placeholder={t(isLength ? "whole" : "toEnd")}
          inputMode="decimal"
          aria-invalid={!!error}
        />
      </div>
    </Field>
  );
}

/** "Start here" / "End here" fills the trim fields from the player position. */
export function markRange(value: RangeText, which: "start" | "end", sec: number, isLength = false): RangeText {
  if (which === "start") return { ...value, start: formatTime(sec) };
  const start = parseRange(value.start, "", false).start ?? 0;
  return { ...value, end: formatTime(isLength ? Math.max(0, sec - start) : sec) };
}

export function SlowNote({ children }: { children?: ReactNode }) {
  const t = useT(s);
  return (
    <p className="flex gap-2 text-xs leading-relaxed text-muted">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {children ? <>{children} </> : null}
        {t("slowNote")}
      </span>
    </p>
  );
}

function Player({ blob, audio, onMark }: { blob: Blob; audio: boolean; onMark?: (which: "start" | "end", sec: number) => void }) {
  const t = useT(s);
  // Created in the effect (not useMemo) so StrictMode's double effect run can't leave a revoked URL behind.
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [meta, setMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const media = {
    ref,
    src: url,
    controls: true,
    preload: "metadata",
    onLoadedMetadata: () => {
      const v = ref.current;
      if (v) setMeta({ duration: v.duration, width: v.videoWidth ?? 0, height: v.videoHeight ?? 0 });
    },
    onError: () => setFailed(true),
  } as const;
  const mark = (which: "start" | "end") => onMark?.(which, ref.current?.currentTime ?? 0);
  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      {failed ? (
        <p className="rounded-xl bg-surface-2 px-4 py-8 text-center text-xs leading-relaxed text-muted">{t("previewFail")}</p>
      ) : !url ? (
        <div className={audio ? "h-[54px]" : "aspect-video max-h-[52vh] w-full rounded-xl bg-black"} />
      ) : audio ? (
        <audio {...media} className="w-full" />
      ) : (
        <video {...media} playsInline className="max-h-[52vh] w-full rounded-xl bg-black" />
      )}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
          {meta && Number.isFinite(meta.duration) ? <span>{formatTime(meta.duration)}</span> : null}
          {meta?.width ? (
            <span>
              {meta.width}×{meta.height}
            </span>
          ) : null}
          <span>{formatBytes(blob.size)}</span>
        </span>
        {onMark && !failed ? (
          <span className="flex gap-2">
            <Button size="sm" onClick={() => mark("start")} title={t("setStartHint")} data-testid="mark-start">
              <Flag className="size-3.5" />
              {t("setStart")}
            </Button>
            <Button size="sm" onClick={() => mark("end")} title={t("setEndHint")} data-testid="mark-end">
              <FlagTriangleRight className="size-3.5" />
              {t("setEnd")}
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Plays the queued inputs (one at a time, with prev/next) and shows duration + size. */
export function InputPreview({ queue, onMark }: { queue: Queue; onMark?: (which: "start" | "end", sec: number) => void }) {
  const t = useT(s);
  const [i, setI] = useState(0);
  const n = queue.items.length;
  if (!n) return null;
  const idx = Math.min(i, n - 1);
  const item = queue.items[idx];
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-surface">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-4 py-2 min-h-11">
        <h2 className="min-w-0 truncate text-sm font-semibold" title={item.file.name}>
          {t("preview")} <span className="font-normal text-muted">· {item.file.name}</span>
        </h2>
        {n > 1 ? (
          <div className="flex shrink-0 items-center">
            <IconButton label={t("prev")} onClick={() => setI((idx - 1 + n) % n)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="w-10 text-center font-mono text-xs text-muted tabular-nums">
              {idx + 1}/{n}
            </span>
            <IconButton label={t("next")} onClick={() => setI((idx + 1) % n)}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
        ) : null}
      </header>
      <Player key={item.id} blob={item.file} audio={isAudioFile(item.file)} onMark={onMark} />
    </section>
  );
}

/** Player for a single audio/video result, for the Results `children` slot (null keeps the slot empty). */
export function outputPlayer(outputs: Output[]): ReactNode {
  const o = outputs.length === 1 ? outputs[0] : null;
  if (!o || !/^(video|audio)\//.test(o.blob.type)) return null;
  return (
    <div className="-m-4">
      <Player key={o.id} blob={o.blob} audio={o.blob.type.startsWith("audio/")} />
    </div>
  );
}
