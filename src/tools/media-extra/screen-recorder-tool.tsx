import { useEffect, useRef, useState } from "react";
import { MonitorUp, RefreshCw } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { videoArgs } from "../../lib/media/args";
import { recorderType, stampName } from "../../lib/media-extra/record";
import { Button, Field, Segmented, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { ToolLayout } from "../../ui/tool-layout";
import { SlowNote, outputPlayer, useEngine } from "../media/shared";
import { RecControls, useRecorder, useTakes } from "./recorder";
import { s } from "./strings";

const supported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";

/** Screen (+ tab/system audio) and microphone as one stream; two audio sources are mixed with Web Audio. */
function mix(screen: MediaStream, mic: MediaStream | null): { stream: MediaStream; release: () => void } {
  const sources = [screen, mic].filter((m): m is MediaStream => !!m && m.getAudioTracks().length > 0);
  if (sources.length < 2) return { stream: new MediaStream([...screen.getVideoTracks(), ...(sources[0]?.getAudioTracks() ?? [])]), release: () => mic?.getTracks().forEach((t) => t.stop()) };
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  for (const m of sources) ctx.createMediaStreamSource(m).connect(dest);
  return {
    stream: new MediaStream([...screen.getVideoTracks(), ...dest.stream.getAudioTracks()]),
    release: () => {
      sources.forEach((m) => m.getTracks().forEach((t) => t.stop()));
      void ctx.close();
    },
  };
}

export default function ScreenRecorderTool({ meta }: EngineProps) {
  const t = useT(s);
  useEngine(); // warm up ffmpeg for "Convert to MP4"
  const takes = useTakes();
  const rec = useRecorder((blob, seconds) => {
    const type = blob.type.includes("mp4") ? "mp4" : "webm";
    takes.add(`${stampName(t("screenName"), new Date())}.${type}`, blob, seconds);
  });
  const [audio, setAudio] = useState(true);
  const [mic, setMic] = useState(false);
  const [cursor, setCursor] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<MediaStream | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const ok = supported();

  useEffect(() => {
    if (preview.current) preview.current.srcObject = live;
  }, [live, rec.state]);

  const begin = async () => {
    setError(null);
    const type = recorderType("video", (m) => MediaRecorder.isTypeSupported(m));
    if (!type) return setError(t("unsupportedScreen"));
    rec.setState("starting");
    let screen: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({
        // ponytail: capped at 1080p so MediaRecorder keeps up in real time and the MP4 conversion stays quick.
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 }, cursor: cursor ? "always" : "never" } as MediaTrackConstraints,
        audio,
      });
    } catch {
      rec.setState("idle");
      return setError(t("denied"));
    }
    let voice: MediaStream | null = null;
    if (mic) {
      try {
        voice = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        screen.getTracks().forEach((tr) => tr.stop());
        rec.setState("idle");
        return setError(t(e instanceof DOMException && e.name === "NotFoundError" ? "noMic" : "micDenied"));
      }
    }
    const { stream, release } = mix(screen, voice);
    setLive(stream);
    await rec.start(stream, type.mime, () => {
      release();
      setLive(null);
    }, countdown);
  };

  const latest = takes.latest;
  const canMp4 = !!latest && !latest.name.endsWith(".mp4") && !takes.done("mp4");
  const recording = rec.state !== "idle" && rec.state !== "starting";

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="flex min-w-0 flex-col items-center gap-5 rounded-2xl border border-line bg-surface px-4 py-8 text-center sm:py-10">
          {!ok ? (
            <p className="max-w-sm text-sm text-muted">{t("unsupportedScreen")}</p>
          ) : recording ? (
            <>
              {rec.state !== "countdown" ? <video ref={preview} muted autoPlay playsInline className="max-h-[40vh] w-full max-w-2xl rounded-xl bg-black" /> : null}
              <RecControls rec={rec} />
            </>
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg">
                <MonitorUp className="size-6" />
              </span>
              <Button variant="primary" size="lg" onClick={begin} disabled={rec.state === "starting"} data-testid="rec-start">
                {latest ? <RefreshCw className="size-4" /> : null}
                {rec.state === "starting" ? t("pickScreen") : latest ? t("recordAgain") : t("startRec")}
              </Button>
              {error ? (
                <p className="rounded-lg bg-err/10 px-3 py-2 text-xs text-err" role="alert">
                  {error}
                </p>
              ) : null}
              <p className="max-w-md text-xs leading-relaxed text-muted">{t("recNote")}</p>
            </>
          )}
        </section>
      }
      settings={
        <>
          <div className="flex flex-col gap-4">
            <Switch checked={audio} onChange={setAudio} label={t("systemAudio")} hint={t("systemAudioHint")} />
            <Switch checked={mic} onChange={setMic} label={t("mic")} hint={t("micHint")} />
            <Switch checked={cursor} onChange={setCursor} label={t("cursor")} />
          </div>
          <Field label={t("countdown")}>
            <Segmented
              label={t("countdown")}
              value={countdown}
              onChange={setCountdown}
              columns={3}
              size="sm"
              options={[
                { value: 0, label: t("off") },
                { value: 3, label: "3 s" },
                { value: 5, label: "5 s" },
              ]}
            />
          </Field>
          <SlowNote />
        </>
      }
      action={
        latest
          ? takes.panel(
              canMp4 ? (
                <>
                  <Button variant="primary" size="lg" onClick={() => takes.convert("mp4", (io, seconds) => ({ args: mp4Args(io), duration: seconds }))} data-testid="to-mp4">
                    {t("toMp4")}
                  </Button>
                  <p className="text-xs leading-relaxed text-muted">{t("toMp4Hint")}</p>
                </>
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

/** WebM take → H.264/AAC MP4 at a steady 30 fps (MediaRecorder timestamps are variable). */
function mp4Args({ input, out, info }: { input: string; out: string; info: Parameters<typeof videoArgs>[1]["info"] }): string[] {
  return videoArgs(
    { format: "mp4", height: null, quality: 75, audioKbps: 160, fps: 30, start: null, end: null, mute: !info.audio, rotate: 0 },
    { input, output: `${out}/output.mp4`, info },
  );
}
