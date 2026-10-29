import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, ImageUp, Undo2, X } from "lucide-react";
import { uid } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { initialsOf, inkBounds, removePaper } from "../../lib/pdf-extra/sign";
import { Button, IconButton, Segmented, Switch, TextField, cx } from "../../ui/kit";
import { s } from "./strings";

export type Slot = "signature" | "initials";

/** A finished signature: a PNG cropped to its ink. */
export interface SigImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

export const INKS = [
  ["#111111", "inkBlack"],
  ["#1d3fbf", "inkBlue"],
  ["#c62828", "inkRed"],
  ["#1b7a3a", "inkGreen"],
] as const;

/** Handwriting looks from fonts people already have (macOS, Windows, Android, Linux), falling back to the generic cursive. */
const STYLES = [
  `"Snell Roundhand", "Segoe Script", "Dancing Script", "Brush Script MT", cursive`,
  `"Apple Chancery", "Lucida Handwriting", "URW Chancery L", "Lucida Calligraphy", cursive`,
  `"Bradley Hand", "Segoe Print", "Ink Free", "Comic Neue", "Coming Soon", cursive`,
  `"Brush Script MT", "Brush Script Std", "Kristen ITC", "Segoe Script", cursive`,
];

// --- saved signatures (this device only) ---
const SAVED_KEY = "converter.signatures";
const NAME_KEY = "converter.signature-name";

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: saving is a convenience only
  }
}

// --- image helpers ---
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Crops a canvas to its ink with a little margin. */
function cropToInk(c: HTMLCanvasElement): SigImage | null {
  const data = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  const b = inkBounds(data.data, c.width, c.height);
  if (!b) return null;
  const pad = Math.round(Math.max(b.width, b.height) * 0.03) + 2;
  const out = canvas(b.width + pad * 2, b.height + pad * 2);
  out.getContext("2d")!.drawImage(c, b.x, b.y, b.width, b.height, pad, pad, b.width, b.height);
  return { id: uid(), url: out.toDataURL("image/png"), width: out.width, height: out.height };
}

type Point = { x: number; y: number };
/** Pen width as a fraction of the pad width. */
const PEN = 0.0065;

/** Smooth stroke through the midpoints of the sampled points (points are fractions of the pad width). */
function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][], scale: number, ink: string) {
  ctx.strokeStyle = ctx.fillStyle = ink;
  ctx.lineWidth = PEN * scale;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const pts of strokes) {
    const p = pts.map((q) => ({ x: q.x * scale, y: q.y * scale }));
    ctx.beginPath();
    if (p.length === 1) {
      ctx.arc(p[0].x, p[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
    ctx.stroke();
  }
}

function typedImage(text: string, stack: string, ink: string): SigImage | null {
  const size = 160;
  const probe = canvas(1, 1).getContext("2d")!;
  probe.font = `${size}px ${stack}`;
  // Script fonts swing far outside their advance width: leave room on every side, then crop.
  const c = canvas(probe.measureText(text).width + size * 1.5, size * 2.2);
  const ctx = c.getContext("2d")!;
  ctx.font = `${size}px ${stack}`;
  ctx.fillStyle = ink;
  ctx.fillText(text, size * 0.75, size * 1.45);
  return cropToInk(c);
}

async function uploadedImage(file: File, clearPaper: boolean): Promise<SigImage | null> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * k, bmp.height * k);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  if (clearPaper) {
    const data = ctx.getImageData(0, 0, c.width, c.height);
    removePaper(data.data);
    ctx.putImageData(data, 0, 0);
  }
  return cropToInk(c);
}

/** Freehand pad: pointer, pen and touch, with smoothing; strokes live in the parent so they survive tab switches. */
function DrawPad({ strokes, onChange, ink, aspect }: { strokes: Point[][]; onChange: (s: Point[][]) => void; ink: string; aspect: number }) {
  const t = useT(s);
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef<Point[][] | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paint = (list: Point[][]) => {
    const c = ref.current;
    if (!c || !width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== Math.round(width * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round((width / aspect) * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawStrokes(ctx, list, c.width, ink);
  };

  useEffect(() => paint(strokes));

  const point = (e: PointerEvent | ReactPointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width };
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-white">
      <canvas
        ref={ref}
        role="img"
        aria-label={t("padLabel")}
        data-testid="signature-pad"
        className="block w-full cursor-crosshair touch-none"
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          live.current = [...strokes, [point(e)]];
          paint(live.current);
        }}
        onPointerMove={(e) => {
          const list = live.current;
          if (!list) return;
          const stroke = list[list.length - 1];
          for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) stroke.push(point(ev));
          paint(list);
        }}
        onPointerUp={() => {
          if (live.current) onChange(live.current);
          live.current = null;
        }}
        onPointerCancel={() => {
          if (live.current) onChange(live.current);
          live.current = null;
        }}
      />
      {/* Signing line + prompt, behind the ink. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[8%] bottom-[24%] border-b border-dashed border-black/20" />
      {!strokes.length ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[8%] text-center text-xs text-black/40">
          {t("padHint")}
        </span>
      ) : null}
    </div>
  );
}

type Tab = "draw" | "type" | "upload" | "saved";

export function SignatureDialog({
  slot,
  ink,
  onInk,
  onClose,
  onUse,
}: {
  /** Which slot is being created; null = closed. */
  slot: Slot | null;
  ink: string;
  onInk: (ink: string) => void;
  onClose: () => void;
  onUse: (img: SigImage) => void;
}) {
  const t = useT(s);
  const ref = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("draw");
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [text, setText] = useState("");
  const [style, setStyle] = useState(0);
  const [upload, setUpload] = useState<File | null>(null);
  const [clearPaper, setClearPaper] = useState(true);
  const [uploaded, setUploaded] = useState<SigImage | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [save, setSave] = useState(true);
  const [saved, setSaved] = useState<SigImage[]>([]);
  const initials = slot === "initials";

  // Open/close the native modal and start fresh for each slot.
  useEffect(() => {
    const d = ref.current!;
    if (!slot) {
      if (d.open) d.close();
      return;
    }
    const name = readStore(NAME_KEY, "");
    setText(initials ? initialsOf(name) : name);
    setStrokes([]);
    setUpload(null);
    setUploaded(null);
    const list = readStore<SigImage[]>(SAVED_KEY, []);
    setSaved(list);
    setTab("draw");
    if (!d.open) d.showModal();
  }, [slot, initials]);

  useEffect(() => {
    setUploaded(null);
    setUploadError(false);
    if (!upload) return;
    let alive = true;
    uploadedImage(upload, clearPaper)
      .then((img) => alive && (img ? setUploaded(img) : setUploadError(true)))
      .catch(() => alive && setUploadError(true));
    return () => {
      alive = false;
    };
  }, [upload, clearPaper]);

  const aspect = initials ? 2 : 3;
  const ready = tab === "draw" ? strokes.length > 0 : tab === "type" ? !!text.trim() : tab === "upload" ? !!uploaded : false;

  const finish = (img: SigImage | null, keep: boolean) => {
    if (!img) return;
    if (keep) {
      const list = [img, ...saved.filter((x) => x.url !== img.url)].slice(0, 8);
      writeStore(SAVED_KEY, list);
    }
    onUse(img);
  };

  const use = () => {
    if (tab === "draw") {
      const c = canvas(1200, 1200 / aspect);
      drawStrokes(c.getContext("2d")!, strokes, c.width, ink);
      finish(cropToInk(c), save);
    } else if (tab === "type") {
      if (!initials) writeStore(NAME_KEY, text.trim());
      finish(typedImage(text.trim(), STYLES[style], ink), save);
    } else if (tab === "upload") finish(uploaded, save);
  };

  const removeSaved = (id: string) => {
    const list = saved.filter((x) => x.id !== id);
    setSaved(list);
    writeStore(SAVED_KEY, list);
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: "draw", label: t("draw") },
    { value: "type", label: t("type") },
    { value: "upload", label: t("upload") },
    ...(saved.length ? [{ value: "saved" as const, label: `${t("saved")} · ${saved.length}` }] : []),
  ];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="sig-dialog-title"
      className="m-auto w-[min(600px,calc(100vw-24px))] max-w-none overflow-visible rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      {slot ? (
        <div className="flex max-h-[calc(100dvh-24px)] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id="sig-dialog-title" className="text-sm font-semibold">
              {initials ? t("createInitials") : t("createSignature")}
            </h2>
            <IconButton label={t("cancel")} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </header>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
            <Segmented label={t("signature")} value={tab} onChange={setTab} options={tabs} />

            {tab === "draw" || tab === "type" ? (
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("ink")}>
                <span className="text-xs font-medium text-muted">{t("ink")}</span>
                {INKS.map(([color, name]) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={ink === color}
                    aria-label={t(name)}
                    title={t(name)}
                    onClick={() => onInk(color)}
                    className={cx("size-7 rounded-full border-2 transition", ink === color ? "border-accent scale-110" : "border-transparent")}
                  >
                    <span className="block size-full rounded-full border-2 border-surface" style={{ background: color }} />
                  </button>
                ))}
              </div>
            ) : null}

            {tab === "draw" ? (
              <div className="flex flex-col gap-2">
                <DrawPad strokes={strokes} onChange={setStrokes} ink={ink} aspect={aspect} />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setStrokes(strokes.slice(0, -1))} disabled={!strokes.length}>
                    <Undo2 className="size-3.5" />
                    {t("undo")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStrokes([])} disabled={!strokes.length}>
                    <Eraser className="size-3.5" />
                    {t("clear")}
                  </Button>
                </div>
              </div>
            ) : tab === "type" ? (
              <div className="flex flex-col gap-3">
                <TextField
                  label={initials ? t("initials") : t("yourName")}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={initials ? "AL" : t("namePlaceholder")}
                  maxLength={initials ? 6 : 60}
                  autoComplete="name"
                  data-testid="typed-name"
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("style")}>
                  {STYLES.map((stack, i) => (
                    <button
                      key={stack}
                      type="button"
                      role="radio"
                      aria-checked={style === i}
                      aria-label={`${t("style")} ${i + 1}`}
                      onClick={() => setStyle(i)}
                      className={cx(
                        "flex h-20 min-w-0 items-center justify-center overflow-hidden rounded-xl border bg-white px-3 text-[34px] leading-none transition",
                        style === i ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line hover:border-line-strong",
                      )}
                      style={{ fontFamily: stack, color: ink }}
                    >
                      <span className="truncate">{text.trim() || (initials ? "AL" : t("signature"))}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : tab === "upload" ? (
              <div className="flex flex-col gap-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                  className="sr-only"
                  data-testid="signature-upload"
                  onChange={(e) => {
                    setUpload(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <div className="checker flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-line p-3">
                  {uploaded ? (
                    <img src={uploaded.url} alt="" className="max-h-40 max-w-full object-contain" data-testid="upload-preview" />
                  ) : (
                    <Button onClick={() => fileInput.current?.click()}>
                      <ImageUp className="size-4" />
                      {t("chooseImage")}
                    </Button>
                  )}
                </div>
                {uploadError ? (
                  <p className="text-xs text-err" role="alert">
                    {t("imageBroken")}
                  </p>
                ) : (
                  <p className="text-xs text-muted">{t("imageHint")}</p>
                )}
                {uploaded ? (
                  <Button size="sm" variant="ghost" className="self-start" onClick={() => fileInput.current?.click()}>
                    <ImageUp className="size-3.5" />
                    {t("replaceImage")}
                  </Button>
                ) : null}
                <Switch label={t("removeWhite")} hint={t("removeWhiteHint")} checked={clearPaper} onChange={setClearPaper} />
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="saved-signatures">
                {saved.map((img) => (
                  <li key={img.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => finish(img, false)}
                      aria-label={t("useSaved")}
                      className="checker flex h-20 w-full items-center justify-center rounded-xl border border-line p-2 transition hover:border-accent"
                    >
                      <img src={img.url} alt="" className="max-h-full max-w-full object-contain" />
                    </button>
                    <IconButton label={t("deleteSaved")} onClick={() => removeSaved(img.id)} className="absolute top-1 right-1 size-6 bg-surface/90">
                      <X className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {tab !== "saved" ? (
            <footer className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 sm:max-w-[60%]">
                <Switch label={t("saveForLater")} checked={save} onChange={setSave} />
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={onClose}>{t("cancel")}</Button>
                <Button variant="primary" onClick={use} disabled={!ready} data-testid="use-signature">
                  {t("useIt")}
                </Button>
              </div>
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
