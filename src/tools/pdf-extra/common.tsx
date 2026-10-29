import { useId, useState, type ReactNode, type Ref } from "react";
import { Eye, EyeOff, FileWarning } from "lucide-react";
import { useT } from "../../lib/i18n";
import { ENCRYPTED } from "../../lib/pdf/edit";
import { navigate } from "../../lib/router";
import { cx } from "../../ui/kit";
import { s } from "./strings";

/** In-app link to another tool page. */
export function ToolLink({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <a
      href={`/${slug}`}
      className="font-medium text-accent-text underline underline-offset-2 hover:no-underline"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(`/${slug}`);
      }}
    >
      {children}
    </a>
  );
}

/** Red notice for a PDF that couldn't be opened; password-protected files get a link to Unlock PDF. */
export function LoadError({ message }: { message: string }) {
  const t = useT(s);
  return (
    <p className="flex items-start gap-2 rounded-2xl border border-line bg-surface px-4 py-4 text-sm text-err" role="alert">
      <FileWarning className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        {message}
        {message === ENCRYPTED ? (
          <>
            {". "}
            <ToolLink slug="unlock-pdf">{t("unlockFirst")}</ToolLink>
          </>
        ) : null}
      </span>
    </p>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({
  label,
  value,
  onChange,
  hint,
  error,
  autoComplete = "new-password",
  testId,
  ref,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  autoComplete?: string;
  testId?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  const t = useT(s);
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <div className={cx("flex h-9 items-center rounded-[10px] border bg-surface pl-3 focus-within:border-accent", error ? "border-err" : "border-line")}>
        <input
          ref={ref}
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={!!error}
          data-testid={testId}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t("hidePassword") : t("showPassword")}
          title={shown ? t("hidePassword") : t("showPassword")}
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:text-fg"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error ? (
        <p className="text-xs leading-relaxed text-err" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
