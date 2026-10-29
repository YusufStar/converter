import { useEffect, useRef, useState } from "react";
import { Mic, RefreshCw } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { audioArgs, type AudioFormat } from "../../lib/media/args";
import { meterLevel, recorderType, stampName } from "../../lib/media-extra/record";
import { Button, Field, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { ToolLayout } from "../../ui/tool-layout";
import { SlowNote, outputPlayer, useEngine } from "../media/shared";
import { RecControls, useRecorder, useTakes } from "./recorder";
import { s } from "./strings";

const supported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

/** Live input level: a scrolling history of bars plus a meter, fed by an AnalyserNode. */
function LevelMeter({ analyser, active }: { analyser: AnalyserNode; active: boolean }) {
  const t = useT(s);
  const canvas = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const buf = new Float32Array(analyser.fftSize);
    const history: number[] = [];
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      const level = meterLevel(buf);
      if (bar.current) bar.current.style.transform = `scaleX(${level})`;
      const c = canvas.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
        if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
        // Paused takes don't scroll.
        if (activeRef.current) history.push(level);
        const cols = Math.floor(w / 3);
        if (history.length > cols) history.splice(0, history.length - cols);
        const g = c.getContext("2d");
        if (g) {
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.clearRect(0, 0, w, h);
          g.fillStyle = getComputedStyle(c).getPropertyValue("--accent") || "#ff6b2c";
          history.forEach((v, i) => {
            const bh = Math.max(1.5, v * (h - 4));
            g.fillRect(w - (history.length - i) * 3, (h - bh) / 2, 2, bh);
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <canvas ref={canvas} className="h-20 w-full" data-testid="voice-wave" />
      <div className="flex items-center gap-2" title={t("level")}>
        <span className="sr-only">{t("level")}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div ref={bar} className="h-full origin-left rounded-full bg-accent transition-transform duration-75" style={{ transform: "scaleX(0)" }} data-testid="voice-meter" />
        </div>
      </div>
    </div>
  );
}

export default function VoiceRecorderTool({ meta }: EngineProps) {
  const t = useT(s);
  useEngine(); // warm up ffmpeg for MP3/WAV
  const takes = useTakes();
  const rec = useRecorder((blob, seconds) => {
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    takes.add(`${stampName(t("voiceName"), new Date())}.${ext}`, blob, seconds);
  });
  const [clean, setClean] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const ok = supported();

  const begin = async () => {
    setError(null);
    const type = recorderType("audio", (m) => MediaRecorder.isTypeSupported(m));
    if (!type) return setError(t("unsupportedMic"));
    rec.setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean } });
    } catch (e) {
      rec.setState("idle");
      return setError(t(e instanceof DOMException && e.name === "NotFoundError" ? "noMic" : "micDenied"));
    }
    const ctx = new AudioContext();
    const node = ctx.createAnalyser();
    node.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(node);
    setAnalyser(node);
    await rec.start(stream, type.mime, () => {
      setAnalyser(null);
      void ctx.close();
    });
  };

  const convert = (format: AudioFormat) =>
    takes.convert(format, ({ input, out, info }, seconds) => ({
      args: audioArgs(
        { format, kbps: 192, sampleRate: null, channels: null, start: null, end: null, volume: 100, normalize: false, fadeIn: 0, fadeOut: 0 },
        { input, output: `${out}/output.${format}`, info },
      ),
      duration: seconds,
    }));

  const latest = takes.latest;
  const recording = rec.state === "recording" || rec.state === "paused";
  const formats = (["mp3", "wav"] as const).filter((f) => !takes.done(f));

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="flex min-w-0 flex-col items-center gap-5 rounded-2xl border border-line bg-surface px-4 py-8 text-center sm:py-10">
          {!ok ? (
            <p className="max-w-sm text-sm text-muted">{t("unsupportedMic")}</p>
          ) : recording && analyser ? (
            <>
              <LevelMeter analyser={analyser} active={rec.state === "recording"} />
              <RecControls rec={rec} />
            </>
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg">
                <Mic className="size-6" />
              </span>
              <Button variant="primary" size="lg" onClick={begin} disabled={rec.state === "starting"} data-testid="rec-start">
                {latest ? <RefreshCw className="size-4" /> : null}
                {latest ? t("recordAgain") : t("startVoice")}
              </Button>
              {error ? (
                <p className="rounded-lg bg-err/10 px-3 py-2 text-xs text-err" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </section>
      }
      settings={
        <>
          <Switch checked={clean} onChange={setClean} label={t("clean")} hint={t("cleanHint")} />
          <SlowNote />
        </>
      }
      action={
        latest
          ? takes.panel(
              formats.length ? (
                <Field label={t("convertTo")}>
                  <div className="grid grid-cols-2 gap-2">
                    {formats.map((f) => (
                      <Button key={f} variant="primary" onClick={() => convert(f)} data-testid={`to-${f}`}>
                        {t(f === "mp3" ? "toMp3" : "toWav")}
                      </Button>
                    ))}
                  </div>
                </Field>
              ) : null,
            )
          : null
      }
      results={
        <Results outputs={takes.outputs} zipName={`${meta.slug}.zip`}>
          {takes.outputs[0] ? outputPlayer([takes.outputs[0]]) : null}
        </Results>
      }
    />
  );
}
