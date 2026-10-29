import type { ReactNode } from "react";
import { Loader2, Play, Square, Star } from "lucide-react";
import { GROUPS, relatedTools, type ToolMeta } from "../catalog";
import { useLang, useT } from "../lib/i18n";
import { toggleFavorite, useFavorites } from "../lib/prefs";
import type { Queue } from "../lib/use-queue";
import { ToolIcon } from "../icons";
import { ErrorText } from "./error-text";
import { Button, FormatChip, IconButton, ProgressBar, cx } from "./kit";
import { Link } from "./link";
import { ui } from "./strings";

/**
 * Page frame for every tool:
 *   mobile:  header → input → settings → results
 *   desktop: header / (input + results | sticky settings)
 */
export function ToolLayout({
  meta,
  input,
  settings,
  action,
  results,
}: {
  meta: ToolMeta;
  input: ReactNode;
  settings?: ReactNode;
  action?: ReactNode;
  results?: ReactNode;
}) {
  const lang = useLang();
  const t = useT(ui);
  const group = GROUPS.find((g) => g.id === meta.group);
  const fav = useFavorites().includes(meta.slug);
  const related = relatedTools(meta);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex min-w-0 items-start gap-4">
        <ToolIcon slug={meta.slug} group={meta.group} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted uppercase">{group?.name[lang]}</span>
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">{meta.name[lang]}</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted text-pretty">{meta.desc[lang]}</p>
          {meta.formats?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {meta.formats.map((f) => (
                <FormatChip key={f}>{f}</FormatChip>
              ))}
            </div>
          ) : null}
          {related.length ? (
            <nav aria-label={t("related")} className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">{t("related")}:</span>
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to={`/${r.slug}`}
                  className="rounded-full border border-line px-2.5 py-1 text-xs font-medium transition hover:border-accent hover:bg-accent-soft"
                >
                  {r.name[lang]}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        <IconButton
          label={fav ? t("removeFavorite") : t("addFavorite")}
          aria-pressed={fav}
          onClick={() => toggleFavorite(meta.slug)}
          className={cx("shrink-0", fav && "text-accent-text")}
          data-testid="favorite"
        >
          <Star className={cx("size-4", fav && "fill-current")} />
        </IconButton>
      </header>

      <div className="grid min-w-0 gap-5 [grid-template-areas:'input'_'settings'_'results'] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'input_settings'_'results_settings'] xl:grid-cols-[minmax(0,1fr)_368px]">
        <div className="min-w-0 [grid-area:input]">{input}</div>
        {settings || action ? (
          <aside className="min-w-0 [grid-area:settings] lg:sticky lg:top-6 lg:self-start">
            <div className="flex flex-col rounded-2xl border border-line bg-surface">
              {settings ? (
                <>
                  <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{t("settings")}</h2>
                  <div className="flex flex-col gap-5 p-4">{settings}</div>
                </>
              ) : null}
              {action ? <div className="border-t border-line p-4 first:border-t-0">{action}</div> : null}
            </div>
          </aside>
        ) : null}
        <div className="min-w-0 self-start [grid-area:results] empty:hidden">{results}</div>
      </div>
    </div>
  );
}

/** The Convert button with progress + cancel, wired to a queue. */
export function RunButton({
  queue,
  onRun,
  label,
  disabled,
  status,
  emptyLabel,
}: {
  queue: Queue;
  onRun: () => void;
  label?: string;
  /** Shown while nothing is queued (defaults to "Add files to start"). */
  emptyLabel?: string;
  disabled?: boolean;
  /** Optional status line while busy, e.g. "Loading engine…". */
  status?: string | null;
}) {
  const t = useT(ui);
  const empty = queue.items.length === 0;
  return (
    <div className="flex flex-col gap-3">
      {queue.busy ? (
        <div className="flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" disabled>
            <Loader2 className="size-4 animate-spin" />
            {t("converting")}
          </Button>
          <Button size="lg" onClick={queue.cancel} aria-label={t("cancel")} title={t("cancel")}>
            <Square className="size-4" />
          </Button>
        </div>
      ) : (
        <Button variant="primary" size="lg" onClick={onRun} disabled={empty || disabled} data-testid="run">
          <Play className="size-4 fill-current" />
          {empty ? (emptyLabel ?? t("addFilesFirst")) : (label ?? t("convert"))}
        </Button>
      )}
      {queue.busy ? (
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={queue.progress} />
          <span className="text-xs text-muted tabular-nums">{status ?? `${Math.round(queue.progress * 100)}%`}</span>
        </div>
      ) : null}
      {queue.error ? (
        <p className="rounded-lg bg-err/10 px-3 py-2 text-xs text-err" role="alert">
          <ErrorText message={queue.error} files={queue.items.map((it) => it.file)} />
        </p>
      ) : null}
    </div>
  );
}
