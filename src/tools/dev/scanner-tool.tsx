import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, Flashlight, FlashlightOff, Loader2, ScanLine, SwitchCamera, Square } from "lucide-react";
import type { EngineProps } from "../../engines";
import { formatLabel, polygon, scanFile, scanPixels, scanPool, webLink, type ScanCode, type ScanResult } from "../../lib/dev/scan";
import { useT } from "../../lib/i18n";
import { useObjectUrl } from "../../lib/use-object-url";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, cx } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { CopyButton, ListCard, Note, Tabs } from "../utility/shared";
import { Badge } from "./shared";
import { devCommon, scanS } from "./strings";

type Mode = "images" | "camera";

const ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif";

function Overlay({ codes, width, height }: { codes: ScanCode[]; width: number; height: number }) {
  if (!width || !height) return null;
  const r = Math.max(width, height) / 50;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {codes.map((c, i) => (
        <g key={i}>
          <polygon points={polygon(c.position)} fill="rgb(255 107 44 / 0.18)" stroke="#ff6b2c" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <circle cx={c.position.topLeft.x} cy={c.position.topLeft.y} r={r} fill="#ff6b2c" />
          <text x={c.position.topLeft.x} y={c.position.topLeft.y} dy="0.35em" textAnchor="middle" fontSize={r * 1.2} fontWeight={700} fill="#1a0f08">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

function CodeRow({ code, index }: { code: ScanCode; index?: number }) {
  const tc = useT(devCommon);
  const link = webLink(code.text);
  return (
    <li className="flex min-w-0 items-start gap-3 px-4 py-2.5" data-testid="scan-code">
      {index !== undefined ? (
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">{index + 1}</span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase" data-testid="scan-format">
          {formatLabel(code.format)}
        </span>
        <span className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap wrap-anywhere" data-testid="scan-text">
          {code.text}
        </span>
      </div>
      <div className="-my-1 flex shrink-0 items-center gap-1">
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-accent-text hover:bg-surface-2">
            <ExternalLink className="size-3.5" />
            <span className="hidden sm:inline">{tc("open")}</span>
          </a>
        ) : null}
        <CopyButton value={code.text} />
      </div>
    </li>
  );
}

function ImageResult({ file, result }: { file: File; result: ScanResult }) {
  const t = useT(scanS);
  const url = useObjectUrl(file);
  const [natural, setNatural] = useState({ w: result.width, h: result.height });
  const n = result.codes.length;
  return (
    <ListCard
      testId="scan-result"
      title={<span className="break-all">{file.name}</span>}
      actions={n ? <Badge tone="ok">{t(n === 1 ? "codesOne" : "codesN", { n })}</Badge> : <Badge tone="muted">{t("codesN", { n: 0 })}</Badge>}
    >
      <div className="checker flex min-w-0 justify-center border-b border-line p-3">
        <div className="relative inline-block max-w-full">
          {url ? (
            <img
              src={url}
              alt=""
              className="block h-auto max-h-[420px] w-auto max-w-full"
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
          ) : null}
          <Overlay codes={result.codes} width={natural.w} height={natural.h} />
        </div>
      </div>
      {n ? (
        <ul className="divide-y divide-line">
          {result.codes.map((c, i) => (
            <CodeRow key={i} code={c} index={i} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted" data-testid="scan-empty">
          {t("noCodes")}
        </p>
      )}
    </ListCard>
  );
}

function Images() {
  const t = useT(scanS);
  const queue = useQueue();
  const [results, setResults] = useState(new Map<File, ScanResult>());
  const done = useRef(results);
  done.current = results;

  const run = useCallback(
    () =>
      queue.runEach(async (file, ctx) => {
        if (done.current.has(file)) return [];
        const r = await scanFile(file, ctx.signal);
        setResults((prev) => new Map(prev).set(file, r));
        return [];
      }, scanPool().size),
    [queue.runEach],
  );

  // New images are scanned as soon as they are added.
  const pending = queue.items.some((i) => i.status === "idle");
  useEffect(() => {
    if (pending && !queue.busy) void run();
  }, [pending, queue.busy, run]);

  const all = queue.items.flatMap((i) => results.get(i.file)?.codes ?? []);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FileInput queue={queue} accept={ACCEPT} formats="PNG, JPG, WEBP, GIF, BMP, AVIF" />
      {queue.busy ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          {t("scanning")}
        </p>
      ) : null}
      {all.length > 1 ? (
        <div className="flex justify-end">
          <CopyButton value={all.map((c) => c.text).join("\n")} text />
        </div>
      ) : null}
      {queue.items.map((item) => {
        const r = results.get(item.file);
        return r ? <ImageResult key={item.id} file={item.file} result={r} /> : null;
      })}
    </div>
  );
}

type CamState = { phase: "idle" | "starting" | "live" } | { phase: "error"; message: string };

function CameraScanner() {
  const t = useT(scanS);
  const tc = useT(devCommon);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const loop = useRef(0);
  const [state, setState] = useState<CamState>({ phase: "idle" });
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [torch, setTorch] = useState<boolean | null>(null);
  const [frame, setFrame] = useState<ScanResult | null>(null);
  const [found, setFound] = useState<ScanCode[]>([]);

  const stop = useCallback(() => {
    loop.current++;
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    setFrame(null);
    setTorch(null);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async (face = facing) => {
    stop();
    if (!navigator.mediaDevices?.getUserMedia) return setState({ phase: "error", message: t("camInsecure") });
    setState({ phase: "starting" });
    const id = ++loop.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: face }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (id !== loop.current) return s.getTracks().forEach((tr) => tr.stop());
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      const track = s.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setState({ phase: "live" });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      while (id === loop.current) {
        if (v.readyState >= 2 && v.videoWidth) {
          // Downscale big frames: plenty for reading, and keeps every frame quick.
          const k = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * k);
          canvas.height = Math.round(v.videoHeight * k);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const r = await scanPixels(ctx.getImageData(0, 0, canvas.width, canvas.height)).catch(() => null);
          if (id !== loop.current) break;
          if (r) {
            setFrame({ ...r, width: canvas.width, height: canvas.height });
            if (r.codes.length)
              setFound((prev) => {
                const fresh = r.codes.filter((c) => !prev.some((p) => p.text === c.text && p.format === c.format));
                if (fresh.length) navigator.vibrate?.(40);
                return fresh.length ? [...fresh, ...prev] : prev;
              });
          }
        }
        await new Promise((res) => setTimeout(res, 80));
      }
    } catch (e) {
      if (id !== loop.current) return;
      stop();
      const name = e instanceof DOMException ? e.name : "";
      setState({
        phase: "error",
        message: name === "NotAllowedError" || name === "SecurityError" ? t("camDenied") : name === "NotFoundError" || name === "OverconstrainedError" ? t("camNone") : t("camFailed", { msg: e instanceof Error ? e.message : String(e) }),
      });
    }
  };

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const live = state.phase === "live" || state.phase === "starting";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
        <div className={cx("relative", facing === "user" && "-scale-x-100")}>
          <video ref={video} muted playsInline className={cx("block h-auto w-full", !live && "hidden")} data-testid="scan-video" />
          {frame ? <Overlay codes={frame.codes} width={frame.width} height={frame.height} /> : null}
        </div>
        {!live ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center">
            <Camera className="size-8 text-white/60" />
            <Button variant="primary" onClick={() => start()} data-testid="scan-start">
              <ScanLine className="size-4" />
              {t("start")}
            </Button>
          </div>
        ) : null}
        {state.phase === "starting" ? <Loader2 className="absolute top-1/2 left-1/2 size-6 -translate-1/2 animate-spin text-white" /> : null}
      </div>
      {live ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              stop();
              setState({ phase: "idle" });
            }}
          >
            <Square className="size-3.5" />
            {t("stop")}
          </Button>
          <Button
            onClick={() => {
              const next = facing === "environment" ? "user" : "environment";
              setFacing(next);
              void start(next);
            }}
          >
            <SwitchCamera className="size-4" />
            {t("switchCam")}
          </Button>
          {torch !== null ? (
            <Button onClick={toggleTorch} aria-pressed={torch}>
              {torch ? <FlashlightOff className="size-4" /> : <Flashlight className="size-4" />}
              {torch ? t("torchOff") : t("torchOn")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.phase === "error" ? <Note tone="err">{state.message}</Note> : <Note>{t("camHint")}</Note>}
      {found.length || live ? (
        <ListCard
          title={t("found")}
          testId="camera-results"
          actions={
            found.length ? (
              <Button size="sm" variant="ghost" onClick={() => setFound([])}>
                {tc("clear")}
              </Button>
            ) : null
          }
        >
          {found.length ? (
            <ul className="divide-y divide-line">
              {found.map((c) => (
                <CodeRow key={`${c.format}:${c.text}`} code={c} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted">
              <Loader2 className="size-3.5 animate-spin" />
              {t("waiting")}
            </p>
          )}
        </ListCard>
      ) : null}
    </div>
  );
}

export default function ScannerTool({ meta }: EngineProps) {
  const t = useT(scanS);
  const tc = useT(devCommon);
  const [mode, setMode] = useState<Mode>((meta.preset?.mode as Mode | undefined) ?? "images");
  // Warm up one reader worker (script + wasm) while the user picks a source.
  useEffect(() => scanPool().warm(), []);
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<Mode>
            label={t("mode")}
            value={mode}
            onChange={setMode}
            className="grid-cols-2 sm:max-w-xs"
            options={[
              { value: "images", label: t("tabImages") },
              { value: "camera", label: t("tabCamera") },
            ]}
          />
          {mode === "images" ? <Images /> : <CameraScanner />}
        </div>
      }
      settings={
        <>
          <Note>{t("imagesHint")}</Note>
          <Note>{tc("localOnly")}</Note>
        </>
      }
    />
  );
}
