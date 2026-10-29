import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:brightness-105 active:brightness-95 shadow-[0_1px_0_rgb(255_255_255/0.35)_inset,0_6px_16px_-6px_rgb(255_107_44/0.6)]",
  secondary: "bg-surface text-fg border border-line hover:border-line-strong hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "text-err hover:bg-err/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition duration-150 ease-out-soft select-none disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-35",
        className,
      )}
      {...props}
    />
  );
}

/** Label + optional hint wrapper for one setting. */
export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

export interface Choice<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Button group for picking one option (preferred over dropdowns for short lists). */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  columns,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Choice<T>[];
  label: string;
  /** Force a grid with N columns instead of a wrapping row. */
  columns?: number;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("gap-1 rounded-xl bg-surface-2 p-1", columns ? "grid" : "flex flex-wrap")}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "min-w-0 flex-1 truncate rounded-lg px-2.5 font-medium transition duration-150 ease-out-soft disabled:opacity-35",
              size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]",
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

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  suffix = "",
  marks,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  suffix?: string;
  marks?: [string, string];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs tabular-nums">
          {value}
          {suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-5 w-full cursor-pointer"
      />
      {marks ? (
        <div className="flex justify-between text-[11px] text-muted">
          <span>{marks[0]}</span>
          <span>{marks[1]}</span>
        </div>
      ) : null}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  label,
  suffix,
  min,
  max,
  step,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <div className="flex h-9 items-center rounded-[10px] border border-line bg-surface px-3 focus-within:border-accent">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none [appearance:textfield] placeholder:text-muted/70 [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix ? <span className="ml-2 shrink-0 text-xs text-muted">{suffix}</span> : null}
      </div>
    </div>
  );
}

export function TextField({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <input
        id={id}
        className={cx(
          "h-9 min-w-0 rounded-[10px] border border-line bg-surface px-3 text-sm outline-none placeholder:text-muted/70 focus:border-accent",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function TextArea({ label, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <textarea
        id={id}
        className={cx(
          "min-h-40 min-w-0 resize-y rounded-xl border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted/70 focus:border-accent",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium">{label}</span>
        {hint ? <span className="text-xs leading-relaxed text-muted">{hint}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0" />
        <span className="h-5 w-9 rounded-full bg-line-strong transition peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <div className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-1.5">
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded-md border-0 bg-transparent p-0" />
        <span className="font-mono text-xs uppercase">{value}</span>
      </div>
    </div>
  );
}

export function Panel({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("min-w-0 rounded-2xl border border-line bg-surface", className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out-soft" style={{ width: `${Math.max(2, value * 100)}%` }} />
    </div>
  );
}

export function FormatChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-5 items-center rounded-md border border-line px-1.5 font-mono text-[10.5px] font-medium tracking-wide text-muted uppercase", className)}>
      {children}
    </span>
  );
}
