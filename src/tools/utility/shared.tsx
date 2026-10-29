import { useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { AlertCircle, Check, ChevronDown, Copy, Info } from "lucide-react";
import { useT } from "../../lib/i18n";
import { Button, IconButton, cx } from "../../ui/kit";
import { ui } from "../../ui/strings";
import { common } from "./strings";

/** Clipboard API first; falls back to execCommand for non-secure contexts (e.g. LAN over http). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function useCopy(value: string) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? "done" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  };
  return [state, copy] as const;
}

/** Copy control: an icon button by default, a labelled button with `text`. */
export function CopyButton({ value, label, text = false, disabled }: { value: string; label?: string; text?: boolean; disabled?: boolean }) {
  const t = useT(ui);
  const tc = useT(common);
  const [state, copy] = useCopy(value);
  const icon = state === "done" ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />;
  const status = state === "done" ? t("copied") : state === "failed" ? tc("copyFailed") : null;
  if (text)
    return (
      <Button size="sm" onClick={copy} disabled={disabled || !value} data-copied={state === "done" || undefined}>
        {icon}
        {status ?? t("copy")}
      </Button>
    );
  return (
    <IconButton label={status ?? (label ? tc("copyOf", { label }) : t("copy"))} onClick={copy} disabled={disabled || !value} data-copied={state === "done" || undefined}>
      {icon}
    </IconButton>
  );
}

/** Bordered card with an optional header; children sit flush (no padding) so row lists can divide it. */
export function ListCard({ title, actions, children, className, testId }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cx("min-w-0 overflow-hidden rounded-2xl border border-line bg-surface", className)} data-testid={testId}>
      {title || actions ? (
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
          <h2 className="min-w-0 text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Label + monospace value + copy. Label sits above the value on phones and beside it from `sm`. */
export function ValueRow({
  label,
  value,
  copy,
  testId,
  sub,
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Text that Copy puts on the clipboard; defaults to `value` when it is a string. */
  copy?: string;
  testId?: string;
  sub?: ReactNode;
  mono?: boolean;
}) {
  const clip = copy ?? (typeof value === "string" ? value : "");
  return (
    <div className="flex min-w-0 items-start gap-2 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
        <span className="shrink-0 text-xs font-medium text-muted sm:w-40">{label}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cx("min-w-0 text-sm wrap-anywhere", mono && "font-mono")} data-testid={testId}>
            {value}
          </span>
          {sub ? <span className="text-xs text-muted">{sub}</span> : null}
        </div>
      </div>
      <div className="-my-1">
        <CopyButton value={clip} label={typeof label === "string" ? label : undefined} />
      </div>
    </div>
  );
}

/** Native select styled like the kit inputs (for long lists only). */
export function Select({ label, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <div className="relative min-w-0">
        <select
          id={id}
          className={cx(
            "h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-[10px] border border-line bg-surface pr-8 pl-3 text-sm outline-none focus:border-accent",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </div>
  );
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "err" }) {
  const Icon = tone === "err" ? AlertCircle : Info;
  return (
    <p className={cx("flex gap-2 text-xs leading-relaxed", tone === "err" ? "text-err" : "text-muted")} role={tone === "err" ? "alert" : undefined}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Small "label: value" chip used for counters. */
export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-surface-2 px-3 py-2">
      <span className="truncate text-[11px] font-medium text-muted">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Segmented look with a responsive grid (kit Segmented squeezes many options into one row).
 * `className` sets the columns, e.g. "grid-cols-3 sm:grid-cols-6".
 */
export function Tabs<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("grid gap-1 rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-8 min-w-0 truncate rounded-lg px-2 text-[13px] font-medium transition duration-150 ease-out-soft",
              active ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--line)]" : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
