import { useEffect, useRef, useState, type ReactNode } from "react";
import { Circle, Pause, Play, Square } from "lucide-react";
import { uid } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { runFFmpeg, type JobIO, type Plan } from "../../lib/media/ffmpeg";
import { clock } from "../../lib/media-extra/record";
import { errorMessage, type Output } from "../../lib/use-queue";
import { Button, ProgressBar, cx } from "../../ui/kit";
import { useEngineStatus } from "../media/shared";
import { s } from "./strings";

export type RecState = "idle" | "starting" | "countdown" | "recording" | "paused";

/**
 * MediaRecorder with pause/resume, a clock that skips pauses, and an optional
 * countdown. `stop()` (or the source ending) resolves the take as one Blob.
 */
export function useRecorder(onTake: (blob: Blob, seconds: number) => void) {
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [count, setCount] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const time = useRef({ base: 0, since: 0 });
  const cleanup = useRef<() => void>(() => {});
  const cancelled = useRef(false);
  const take = useRef(onTake);
  take.current = onTake;

  const now = () => time.current.base + (time.current.since ? performance.now() - time.current.since : 0);

  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsed(now() / 1000), 250);
    return () => clearInterval(id);
  }, [state]);

  // Leaving the page mid-recording releases the camera/mic/screen.
  useEffect(() => () => {
    cancelled.current = true;
    if (rec.current?.state !== "inactive") rec.current?.stop();
    cleanup.current();
  }, []);

  /** `stream` is recorded; `release` stops its sources once the take ends. */
  const start = async (stream: MediaStream, mime: string, release: () => void, countdown = 0) => {
    cancelled.current = false;
    cleanup.current = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      release();
    };
    setState("countdown");
    for (let n = countdown; n > 0; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 1000));
      if (cancelled.current) return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, { mimeType: mime });
    rec.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const seconds = now() / 1000;
      time.current = { base: 0, since: 0 };
      cleanup.current();
      setState("idle");
      setElapsed(0);
      if (chunks.length) take.current(new Blob(chunks, { type: mime.split(";")[0] }), seconds);
    };
    // The browser's own "Stop sharing" button ends the video track.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => r.state !== "inactive" && r.stop());
    r.start(1000);
    time.current = { base: 0, since: performance.now() };
    setElapsed(0);
    setState("recording");
  };

  const pause = () => {
    rec.current?.pause();
    time.current = { base: now(), since: 0 };
    setElapsed(now() / 1000);
    setState("paused");
  };
  const resume = () => {
    rec.current?.resume();
    time.current.since = performance.now();
    setState("recording");
  };
  const stop = () => {
    if (state === "countdown") {
      cancelled.current = true;
      cleanup.current();
      setState("idle");
    } else if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  };

  return { state, setState, elapsed, count, start, pause, resume, stop };
}

/** Countdown number, or the red-dot clock with pause/resume/stop. */
export function RecControls({ rec }: { rec: ReturnType<typeof useRecorder> }) {
  const t = useT(s);
  if (rec.state === "countdown")
    return (
      <div className="flex flex-col items-center gap-2" aria-live="assertive">
        <span className="text-xs text-muted">{t("getReady")}</span>
        <span key={rec.count} className="animate-rise text-6xl font-semibold tabular-nums" data-testid="countdown">
          {rec.count}
        </span>
        <Button size="sm" variant="ghost" onClick={rec.stop}>
          {t("stop")}
        </Button>
      </div>
    );
  const paused = rec.state === "paused";
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2.5" aria-live="polite">
        <Circle className={cx("size-3 fill-current", paused ? "text-muted" : "animate-pulse text-err")} />
        <span className="text-sm font-medium">{t(paused ? "paused" : "recording")}</span>
        <span className="font-mono text-2xl tabular-nums" data-testid="rec-clock">
          {clock(rec.elapsed)}
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={paused ? rec.resume : rec.pause} data-testid="rec-pause">
          {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4" />}
          {t(paused ? "resume" : "pause")}
        </Button>
        <Button variant="primary" onClick={rec.stop} data-testid="rec-stop">
          <Square className="size-4 fill-current" />
          {t("stopRec")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Takes (newest first) plus ffmpeg conversions of the newest take. Each conversion is
 * added next to its source, so nothing recorded is ever replaced.
 */
export function useTakes() {
  const t = useT(s);
  const engine = useEngineStatus();
  const [outputs, setOutputs] = useState<(Output & { seconds?: number; from?: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const add = (name: string, blob: Blob, seconds: number) => setOutputs((o) => [{ id: uid(), name, blob, seconds }, ...o]);
  const latest = outputs.find((o) => !o.from);
  const done = (ext: string) => !!latest && outputs.some((o) => o.from === latest.id && o.name.endsWith(`.${ext}`));

  const convert = async (ext: string, plan: (io: JobIO, seconds: number | undefined) => Plan) => {
    if (!latest) return;
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const file = new File([latest.blob], latest.name, { type: latest.blob.type });
      const r = await runFFmpeg(file, (io) => plan(io, latest.seconds), { signal: c.signal, onProgress: setProgress });
      const name = latest.name.replace(/\.[^.]+$/, `.${ext}`);
      setOutputs((o) => [{ id: uid(), name, blob: r.files[0].blob, from: latest.id, sourceSize: latest.blob.size }, ...o]);
    } catch (e) {
      if (!c.signal.aborted) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** Progress + cancel while converting, else the given buttons. */
  const panel = (buttons: ReactNode) =>
    busy ? (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ProgressBar value={progress} className="flex-1" />
          <Button size="sm" onClick={() => ctrl.current?.abort()} aria-label={t("stop")} title={t("stop")}>
            <Square className="size-3.5" />
          </Button>
        </div>
        <span className="text-xs text-muted tabular-nums">{engine ?? `${t("converting")} ${Math.round(progress * 100)}%`}</span>
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        {buttons}
        {error ? (
          <p className="rounded-lg bg-err/10 px-3 py-2 text-xs text-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );

  return { outputs, add, latest, done, convert, busy, panel };
}
