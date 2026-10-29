import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AlertCircle, Check, Copy, Info, Loader2 } from "lucide-react";
import { formatBytes } from "../../lib/files";
import { useT } from "../../lib/i18n";
import type { Store } from "../../lib/ml/download";
import { OCR_LANGS } from "../../lib/ml/ocr";
import { ocrStatus } from "../../lib/ml/ocr-engine";
import type { Output } from "../../lib/use-queue";
import { Button, Field, ProgressBar, Segmented, cx } from "../../ui/kit";
import { ui } from "../../ui/strings";
import { s } from "./strings";

export const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.get, store.get);

export const IMAGE_INPUT = [".png", ".jpg", ".jpeg", ".jfif", ".webp", ".avif", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".jxl", "image/*"].join(",");
export const IMAGE_LABEL = "PNG, JPG, WEBP, AVIF, GIF, BMP, TIFF, HEIC";

export const textBlob = (text: string) => new Blob([text], { type: "text/plain;charset=utf-8" });
export const wordCount = (text: string) => text.match(/\S+/g)?.length ?? 0;

export function Hint({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" | "error" }) {
  const Icon = tone === "error" ? AlertCircle : Info;
  return (
    <p
      className={cx(
        "flex gap-2 text-xs leading-relaxed",
        tone === "muted" && "text-muted",
        tone === "warn" && "rounded-lg bg-accent-soft px-3 py-2 text-fg",
        tone === "error" && "rounded-lg bg-err/10 px-3 py-2 text-err",
      )}
    >
      <Icon className={cx("mt-0.5 size-3.5 shrink-0", tone === "warn" && "text-accent-text")} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Spinner / bar / check line for an engine that loads in the background. */
export function EngineLine({ phase, text, progress }: { phase: "busy" | "ready" | "error"; text: string; progress?: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="status" data-testid="engine-status">
      <span className={cx("flex min-w-0 items-center gap-1.5 text-xs", phase === "error" ? "text-err" : "text-muted")}>
        {phase === "busy" ? <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-text" /> : null}
        {phase === "ready" ? <Check className="size-3.5 shrink-0 text-ok" /> : null}
        {phase === "error" ? <AlertCircle className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 tabular-nums">{text}</span>
      </span>
      {progress !== undefined ? <ProgressBar value={progress} /> : null}
    </div>
  );
}

/** "1.2 MB / 5.0 MB"-style progress text. */
export const bytesOf = (loaded: number, total: number) => ({ done: formatBytes(loaded), total: formatBytes(total) });

/** OCR engine status (language download, start-up, ready) for the settings panel. */
export function OcrStatusLine() {
  const t = useT(s);
  const st = useStore(ocrStatus);
  if (st.phase === "idle") return null;
  if (st.phase === "download") return <EngineLine phase="busy" text={t("engDownload", bytesOf(st.loaded, st.total))} progress={st.total ? st.loaded / st.total : 0} />;
  if (st.phase === "starting") return <EngineLine phase="busy" text={t("engStarting")} />;
  if (st.phase === "error") return <EngineLine phase="error" text={t("engError", { error: st.error ?? "" })} />;
  return <EngineLine phase="ready" text={st.workers > 1 ? t("engReady", { n: st.workers }) : t("engReadyOne")} />;
}

/** Status for the run button while the engine is still loading (null once ready). */
export function useOcrLoadingText(): string | null {
  const t = useT(s);
  const st = useStore(ocrStatus);
  if (st.phase === "download") return t("engDownload", bytesOf(st.loaded, st.total));
  if (st.phase === "starting") return t("engStarting");
  return null;
}

/** Multi-select language toggles; the last selected language can't be switched off. */
export function LangPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const t = useT(s);
  return (
    <Field label={t("languages")} hint={t("languagesHint")}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("languages")}>
        {OCR_LANGS.map(({ code, name }) => {
          const on = value.includes(code);
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              disabled={disabled || (on && value.length === 1)}
              onClick={() => onChange(on ? value.filter((c) => c !== code) : [...value, code])}
              className={cx(
                "h-7 rounded-lg border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed",
                on ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg disabled:opacity-45",
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

const PREVIEW_MAX = 200_000;

/** Copy button + preview of one text output (picker when there are several). */
export function useTextPreview(outputs: Output[]) {
  const t = useT(s);
  const tu = useT(ui);
  const texts = outputs.filter((o) => o.blob.type.startsWith("text/"));
  const [selected, setSelected] = useState<string | null>(null);
  // null while the blob is being read.
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const current = texts.find((o) => o.id === selected) ?? texts[0];

  useEffect(() => {
    let alive = true;
    setText(null);
    current?.blob.text().then((v) => alive && setText(v));
    return () => {
      alive = false;
    };
  }, [current]);

  const copy = async () => {
    await navigator.clipboard.writeText(text ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const extra = current ? (
    <Button onClick={copy} disabled={!text?.trim()} data-testid="copy-text">
      {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      {copied ? tu("copied") : tu("copy")}
    </Button>
  ) : null;

  const preview = current ? (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="text-[13px] font-medium">{t("textPreview")}</h3>
      {texts.length > 1 ? (
        <Segmented label={t("textPreview")} value={current.id} onChange={setSelected} size="sm" options={texts.map((o) => ({ value: o.id, label: o.name, title: o.name }))} />
      ) : null}
      {text !== null && !text.trim() ? (
        <Hint tone="warn">{t("noTextLong")}</Hint>
      ) : (
        <pre
          data-testid="text-preview"
          dir="auto"
          className="max-h-[420px] min-h-24 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap"
        >
          {text?.slice(0, PREVIEW_MAX)}
        </pre>
      )}
      {text && text.length > PREVIEW_MAX ? <Hint>{t("truncated", { n: PREVIEW_MAX.toLocaleString() })}</Hint> : null}
    </div>
  ) : null;

  return { extra, preview };
}
