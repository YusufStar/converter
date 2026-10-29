import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "../../ui/kit";

export function Badge({ tone, children, testId }: { tone: "ok" | "err" | "warn" | "muted"; children: ReactNode; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        tone === "ok" && "bg-ok/12 text-ok",
        tone === "err" && "bg-err/10 text-err",
        tone === "warn" && "bg-accent-soft text-accent-text",
        tone === "muted" && "bg-surface-2 text-muted",
      )}
    >
      {children}
    </span>
  );
}

/** Multi-select toggle buttons (the Segmented look, several can be on). */
export function ToggleChips<T extends string>({
  label,
  options,
  values,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  values: T[];
  onChange: (v: T[]) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("grid gap-1 rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? values.filter((v) => v !== o.value) : options.map((x) => x.value).filter((v) => v === o.value || values.includes(v)))}
            className={cx(
              "flex h-8 min-w-0 items-center justify-center gap-1 truncate rounded-lg px-2 text-[13px] font-medium transition duration-150 ease-out-soft",
              on ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--line)]" : "text-muted hover:text-fg",
            )}
          >
            {on ? <Check className="size-3 shrink-0 text-accent-text" /> : null}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Rasterises an SVG string at its own pixel size. */
export async function svgToPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return await canvasPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const canvasPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Luminance order check: dark modules on a light background scan everywhere. */
export const isInverted = (fg: string, bg: string) => contrast(fg, "#000000") > contrast(bg, "#000000");

/** Current time that re-renders every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
