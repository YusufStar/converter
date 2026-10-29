import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { tokenizeRanges } from "../../lib/pdf/ranges";
import type { Queue } from "../../lib/use-queue";
import { Field, Segmented, TextField, cx } from "../../ui/kit";
import { s } from "./strings";

export const PDF_ACCEPT = ".pdf,application/pdf";

export const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: "application/pdf" });

type T = ReturnType<typeof useT<typeof s.en>>;
export const pagesLabel = (t: T, n: number) => (n === 1 ? t("onePage") : t("nPages", { n }));

/** "report.zip" for one input, "<slug>.zip" for a batch. */
export const zipNameFor = (queue: Queue, fallback: string) =>
  queue.items.length === 1 ? `${splitName(queue.items[0].file.name).base}.zip` : `${fallback}.zip`;

export function rangeOk(text: string): boolean {
  try {
    return tokenizeRanges(text).length > 0;
  } catch {
    return false;
  }
}

/** Page-range text input with live syntax check. */
export function RangeField({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  const t = useT(s);
  const bad = value.trim() !== "" && !rangeOk(value);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <TextField
        label={label || undefined}
        aria-label={label || t("pages")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("rangePlaceholder")}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-invalid={bad}
        className={cx("font-mono", bad && "border-err focus:border-err")}
        data-testid="ranges"
      />
      <p className={cx("text-xs leading-relaxed", bad ? "text-err" : "text-muted")}>{bad ? t("rangeInvalid") : t("rangeHelp")}</p>
    </div>
  );
}

export interface Scope {
  all: boolean;
  ranges: string;
}

/** "All pages / Choose pages" + range field. `scopeRanges` gives "" for all. */
export function PageScope({ value, onChange }: { value: Scope; onChange: (v: Scope) => void }) {
  const t = useT(s);
  return (
    <Field label={t("pages")}>
      <Segmented
        label={t("pages")}
        value={value.all ? "all" : "some"}
        onChange={(v) => onChange({ ...value, all: v === "all" })}
        options={[
          { value: "all", label: t("allPages") },
          { value: "some", label: t("choosePages") },
        ]}
        size="sm"
      />
      {value.all ? null : <RangeField label="" value={value.ranges} onChange={(ranges) => onChange({ ...value, ranges })} autoFocus />}
    </Field>
  );
}

export const scopeRanges = (scope: Scope) => (scope.all ? "" : scope.ranges);
/** Choosing pages but leaving the field empty or invalid blocks the run. */
export const scopeInvalid = (scope: Scope) => !scope.all && !rangeOk(scope.ranges);

export function Hint({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" }) {
  return (
    <p
      className={cx(
        "flex gap-2 text-xs leading-relaxed",
        tone === "warn" ? "rounded-lg bg-accent-soft px-3 py-2 text-fg" : "text-muted",
      )}
    >
      <Info className={cx("mt-0.5 size-3.5 shrink-0", tone === "warn" && "text-accent-text")} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A tiny A4 sheet for live previews of where stamps land. */
export function MiniPage({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-surface-2 p-4">
      <div
        role="img"
        aria-label={label}
        className="relative aspect-[1/1.414] w-28 overflow-hidden rounded-[3px] bg-white text-black shadow-[0_1px_2px_rgb(0_0_0/0.12),0_8px_24px_-8px_rgb(0_0_0/0.25)]"
      >
        {/* Faux text lines so the sheet reads as a document. */}
        <div aria-hidden className="absolute inset-x-3 top-5 flex flex-col gap-1.5">
          {[90, 100, 75, 95, 60, 100, 85, 40].map((w, i) => (
            <span key={i} className="h-1 rounded-full bg-black/10" style={{ width: `${w}%` }} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
