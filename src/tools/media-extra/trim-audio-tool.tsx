import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Loader2, Play, Square } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { AUDIO_ACCEPT, audioArgs, clipLength, formatTime, parseRange, type AudioFormat } from "../../lib/media/args";
import { runFFmpeg } from "../../lib/media/ffmpeg";
import { sameAudioFormat } from "../../lib/media-extra/args";
import { peaks } from "../../lib/media-extra/record";
import { useObjectUrl } from "../../lib/use-object-url";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Field, NumberField, Segmented, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { SlowNote, TrimFields, outputPlayer, useMediaRun, type RangeText } from "../media/shared";
import { s } from "./strings";

const BUCKETS = 2400;

/**
 * Waveform peaks of a file. Web Audio decodes at a low rate (the shape is all we need);
 * formats the browser can't decode (AIFF, WMA, AMR…) go through ffmpeg → WAV first.
 */
async function decodeWave(file: File, signal: AbortSignal): Promise<{ peaks: Float32Array; duration: number }> {
  const decode = async (blob: Blob) => {
    // ponytail: 8 kHz keeps an hour of stereo at ~230 MB while decoding; only the peaks are kept.
    const buf = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    return { peaks: peaks(channels, BUCKETS), duration: buf.duration };
  };
  try {
    return await decode(file);
  } catch {
    const r = await runFFmpeg(file, ({ input, out }) => ({ args: ["-i", input, "-vn", "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", `${out}/wave.wav`] }), { signal });
    return decode(r.files[0].blob);
  }
}

function WaveEditor({ file, range, onRange }: { file: File; range: RangeText; onRange: (r: RangeText) => void }) {
  const t = useT(s);
  const [wave, setWave] = useState<{ peaks: Float32Array; duration: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const drag = useRef<"start" | "end" | null>(null);
  const url = useObjectUrl(file);

  useEffect(() => {
    const ctrl = new AbortController();
    setWave(null);
    setFailed(false);
    decodeWave(file, ctrl.signal).then(
      (w) => !ctrl.signal.aborted && setWave(w),
      () => !ctrl.signal.aborted && setFailed(true),
    );
    return () => ctrl.abort();
  }, [file]);

  const duration = wave?.duration ?? 0;
  const parsed = parseRange(range.start, range.end);
  const start = Math.min(duration, parsed.start ?? 0);
  const end = Math.min(duration, parsed.end ?? duration);

  // Draw the bars: one column per device pixel pair, max of the buckets it covers.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !wave) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const g = c.getContext("2d");
      if (!g) return;
      g.scale(dpr, dpr);
      const css = getComputedStyle(c);
      const cols = Math.max(1, Math.floor(w / 2));
      // Scaled to the loudest peak so quiet recordings still read.
      const top = wave.peaks.reduce((a, b) => Math.max(a, b), 0) || 1;
      for (let i = 0; i < cols; i++) {
        const from = Math.floor((i / cols) * wave.peaks.length);
        const to = Math.max(from + 1, Math.floor(((i + 1) / cols) * wave.peaks.length));
        let p = 0;
        for (let j = from; j < to; j++) p = Math.max(p, wave.peaks[j]);
        const sec = ((i + 0.5) / cols) * wave.duration;
        g.fillStyle = sec >= start && sec <= end ? css.getPropertyValue("--accent") || "#ff6b2c" : css.getPropertyValue("--line-strong") || "#999";
        const bh = Math.max(1, (p / top) * (h - 4));
        g.fillRect(i * 2, (h - bh) / 2, 1.5, bh);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [wave, start, end]);

  const set = (which: "start" | "end", sec: number) => {
    const v = Math.max(0, Math.min(duration, sec));
    if (which === "start") onRange({ ...range, start: formatTime(Math.min(v, end - 0.1)) });
    else onRange({ ...range, end: formatTime(Math.max(v, start + 0.1)) });
  };
  const at = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const sec = at(e);
    drag.current = Math.abs(sec - start) <= Math.abs(sec - end) ? "start" : "end";
    e.currentTarget.setPointerCapture(e.pointerId);
    set(drag.current, sec);
  };
  const move = (e: PointerEvent) => drag.current && set(drag.current, at(e));
  const key = (which: "start" | "end") => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    const cur = which === "start" ? start : end;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(which, cur - step);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") set(which, cur + step);
    else return;
    e.preventDefault();
  };

  // Plays [start, end) and draws a playhead.
  useEffect(() => {
    const a = audio.current;
    if (!playing || !a) return;
    a.currentTime = start;
    a.play().catch(() => setPlaying(false));
    let raf = 0;
    const tick = () => {
      if (a.currentTime >= end || a.ended) {
        a.pause();
        setPlaying(false);
        setHead(null);
        return;
      }
      setHead(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      a.pause();
      setHead(null);
    };
    // Restarts only on play/stop: the selection is read when playback starts.
  }, [playing]);

  const pct = (sec: number) => `${duration ? (sec / duration) * 100 : 0}%`;
  const handle = (which: "start" | "end", sec: number) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t(which === "start" ? "handleStart" : "handleEnd")}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={Math.round(sec * 10) / 10}
      aria-valuetext={formatTime(sec)}
      onKeyDown={key(which)}
      data-testid={`handle-${which}`}
      className="absolute inset-y-0 z-10 -ml-2 flex w-4 cursor-ew-resize justify-center outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-accent"
      style={{ left: pct(sec) }}
    >
      <span className="h-full w-0.5 rounded-full bg-accent" />
      <span className={cx("absolute size-3.5 rounded-full border-2 border-accent bg-surface shadow", which === "start" ? "top-0" : "bottom-0")} />
    </div>
  );

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-surface">
      <header className="flex min-h-11 min-w-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {t("waveform")} <span className="font-normal text-muted">· {file.name}</span>
        </h2>
        <Button size="sm" onClick={() => setPlaying((p) => !p)} disabled={!url || (!wave && !failed)} data-testid="play-selection">
          {playing ? <Square className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
          {t(playing ? "stop" : "playSel")}
        </Button>
      </header>
      <div className="flex flex-col gap-2 p-4">
        {url ? <audio ref={audio} src={url} preload="auto" className="hidden" /> : null}
        {failed ? (
          <p className="rounded-xl bg-surface-2 px-4 py-8 text-center text-xs text-muted">{t("noWave")}</p>
        ) : !wave ? (
          <p className="flex h-32 items-center justify-center gap-2 rounded-xl bg-surface-2 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            {t("decoding")}
          </p>
        ) : (
          <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} className="relative h-32 touch-none select-none" data-testid="waveform">
            <canvas ref={canvas} className="size-full" />
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-surface/60" style={{ width: pct(start) }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 bg-surface/60" style={{ left: pct(end) }} />
            {head !== null ? <div className="pointer-events-none absolute inset-y-0 w-px bg-fg" style={{ left: pct(head) }} /> : null}
            {handle("start", start)}
            {handle("end", end)}
          </div>
        )}
        {wave ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
            <span data-testid="selection">{t("selection", { start: formatTime(start), end: formatTime(end), len: formatTime(Math.max(0, end - start)) })}</span>
            <span>{t("dragHint")}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type Out = "same" | "mp3" | "wav";

export default function TrimAudioTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue({ multiple: false });
  const media = useMediaRun(queue);
  const [range, setRange] = useState<RangeText>({ start: "", end: "" });
  const [out, setOut] = useState<Out>("same");
  const [fade, setFade] = useState({ in: 0, out: 0 });
  const { start, end, error } = parseRange(range.start, range.end);
  const file = queue.items[0]?.file;
  const ext = file ? splitName(file.name).ext : "";
  const same = sameAudioFormat(ext);

  // A new file starts with the whole clip selected.
  useEffect(() => setRange({ start: "", end: "" }), [file]);

  const run = () =>
    media.run(async (f, exec) => {
      const format: AudioFormat = out === "same" ? same : out;
      let length: number | undefined;
      const r = await exec(({ input, out: dir, info }) => {
        length = clipLength(info.duration, start, end);
        const o = { format, kbps: 192, sampleRate: null, channels: null, start, end, volume: 100, normalize: false, fadeIn: fade.in, fadeOut: fade.out };
        return { args: audioArgs(o, { input, output: `${dir}/output.${format}`, info }), duration: length };
      });
      return { name: withExt(f.name, format), blob: r.files[0].blob, note: length ? formatTime(length) : undefined };
    });

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={AUDIO_ACCEPT} multiple={false} formats="MP3, WAV, M4A, AAC, OGG, OPUS, FLAC, AIFF, WMA…" />
          {file ? <WaveEditor key={queue.items[0].id} file={file} range={range} onRange={setRange} /> : null}
        </div>
      }
      settings={
        <>
          <TrimFields value={range} onChange={setRange} />
          <Field label={t("outFormat")}>
            <Segmented<Out>
              label={t("outFormat")}
              value={out}
              onChange={setOut}
              columns={3}
              size="sm"
              options={[
                { value: "same", label: t("sameFormat", { ext: (file ? same : "—").toUpperCase() }) },
                { value: "mp3", label: "MP3" },
                { value: "wav", label: "WAV" },
              ]}
            />
          </Field>
          <Field label={t("fades")}>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t("fadeIn")} value={fade.in || null} onChange={(v) => setFade({ ...fade, in: Math.max(0, v ?? 0) })} suffix="s" min={0} step={0.5} placeholder="0" />
              <NumberField label={t("fadeOut")} value={fade.out || null} onChange={(v) => setFade({ ...fade, out: Math.max(0, v ?? 0) })} suffix="s" min={0} step={0.5} placeholder="0" />
            </div>
          </Field>
          <SlowNote />
        </>
      }
      action={<RunButton queue={queue} onRun={run} status={media.status} label={t("trimOne")} disabled={!!error} />}
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {outputPlayer(queue.outputs)}
        </Results>
      }
    />
  );
}
