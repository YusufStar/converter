import { useEffect, useRef, useState, type DragEvent } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Check, FileIcon, GripVertical, Loader2, Plus, Upload, X } from "lucide-react";
import { formatBytes, matchesAccept } from "../lib/files";
import { takeHandoff } from "../lib/handoff";
import { slugFromPath, usePath } from "../lib/router";
import { useT } from "../lib/i18n";
import { useObjectUrl } from "../lib/use-object-url";
import type { Queue, QueueItem } from "../lib/use-queue";
import { ErrorText } from "./error-text";
import { Button, IconButton, ProgressBar, cx } from "./kit";
import { ui } from "./strings";

/** Every file inside dropped folders (recursively), skipping hidden files like .DS_Store. */
async function filesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.name.startsWith(".")) return;
    if (entry.isFile) {
      out.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most ~100 entries per call.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

/**
 * Drop / click / paste target. Shows a big zone while empty and a compact
 * "add more" strip once files are queued.
 */
export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  formats,
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Human readable list, e.g. "PNG, JPG, WEBP, SVG". */
  formats?: string;
  compact?: boolean;
}) {
  const t = useT(ui);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState(0);

  const take = (list: FileList | File[] | null | undefined) => {
    const all = Array.from(list ?? []);
    const ok = all.filter((f) => matchesAccept(f, accept));
    setSkipped(all.length - ok.length);
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  };

  // Paste files (e.g. a screenshot) anywhere on the page while this tool is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        take(e.clipboardData.files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const dragProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      // Entries must be read synchronously inside the drop event.
      const entries = Array.from(e.dataTransfer.items ?? [])
        .map((item) => item.webkitGetAsEntry?.())
        .filter((entry): entry is FileSystemEntry => !!entry);
      if (entries.some((entry) => entry.isDirectory)) void filesFromEntries(entries).then(take);
      else take(e.dataTransfer.files);
    },
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept={accept}
      multiple={multiple}
      className="sr-only"
      data-testid="file-input"
      onChange={(e) => {
        take(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <div
        {...dragProps}
        className={cx(
          "flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2 transition",
          over ? "border-accent bg-accent-soft" : "border-line-strong",
        )}
      >
        {picker}
        <span className="truncate text-xs text-muted">{t("dropBody")}</span>
        <Button size="sm" onClick={() => input.current?.click()}>
          <Plus className="size-3.5" />
          {t("addMore")}
        </Button>
      </div>
    );
  }

  return (
    <div {...dragProps}>
      {picker}
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cx(
          "group relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-12 text-center transition duration-200 ease-out-soft sm:py-16",
          over ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-accent hover:bg-accent-soft/40",
        )}
      >
        <span
          className={cx(
            "flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-[0_10px_30px_-10px_rgb(255_107_44/0.8)] transition duration-300 ease-out-soft",
            over ? "scale-110 -rotate-6" : "group-hover:-translate-y-0.5",
          )}
        >
          <Upload className="size-6" strokeWidth={2.2} />
        </span>
        <span className="text-base font-semibold sm:text-lg">{multiple ? t("dropTitle") : t("dropTitleOne")}</span>
        <span className="text-sm text-muted">{t("dropBody")}</span>
        {formats ? <span className="max-w-md text-xs text-muted/90">{t("dropAccept", { formats })}</span> : null}
      </button>
      {skipped > 0 ? (
        <p className="mt-2 text-xs text-err" role="status">
          {skipped} × {formats ? t("dropAccept", { formats }) : "unsupported"}
        </p>
      ) : null}
    </div>
  );
}

const PREVIEWABLE = /^image\/(png|jpe?g|webp|avif|gif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;

function Thumb({ file }: { file: File }) {
  const url = useObjectUrl(PREVIEWABLE.test(file.type) ? file : null);
  const [broken, setBroken] = useState(false);
  return (
    <span className="checker flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line">
      {url && !broken ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <FileIcon className="size-4 text-muted" />
      )}
    </span>
  );
}

function StatusIcon({ item }: { item: QueueItem }) {
  const t = useT(ui);
  if (item.status === "working") return <Loader2 aria-label={t("working")} className="size-4 animate-spin text-accent-text" />;
  if (item.status === "done") return <Check aria-label={t("done")} className="size-4 text-ok" />;
  if (item.status === "error") return <AlertCircle aria-label={t("failed")} className="size-4 text-err" />;
  return null;
}

/** The queued input files with status, remove and (optionally) reorder. */
export function QueueList({ queue, reorderable = false }: { queue: Queue; reorderable?: boolean }) {
  const t = useT(ui);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const total = queue.items.reduce((a, it) => a + it.file.size, 0);

  if (!queue.items.length) return null;
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="truncate text-sm font-semibold">
          {t("files")} <span className="font-normal text-muted">· {t(queue.items.length === 1 ? "fileCountOne" : "filesCount", { n: queue.items.length, size: formatBytes(total) })}</span>
        </h2>
        <Button size="sm" variant="ghost" onClick={queue.clear} disabled={queue.busy}>
          <X className="size-3.5" />
          {t("clearAll")}
        </Button>
      </header>
      <ul className="max-h-[420px] divide-y divide-line overflow-y-auto" data-testid="queue">
        {queue.items.map((item, i) => (
          <li
            key={item.id}
            draggable={reorderable && !queue.busy}
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => reorderable && e.preventDefault()}
            onDrop={() => {
              if (dragFrom !== null) queue.move(dragFrom, i);
              setDragFrom(null);
            }}
            className={cx("flex min-w-0 items-center gap-3 px-3 py-2.5 animate-rise", dragFrom === i && "opacity-50")}
          >
            {reorderable ? <GripVertical className="size-4 shrink-0 cursor-grab text-muted/60" aria-hidden /> : null}
            {reorderable ? <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{i + 1}</span> : null}
            <Thumb file={item.file} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="line-clamp-2 text-sm font-medium break-all" title={item.file.name}>
                {item.file.name}
              </span>
              {item.status === "working" ? (
                <ProgressBar value={item.progress} className="max-w-56" />
              ) : item.status === "error" && item.error ? (
                <span className="line-clamp-2 text-xs text-err" title={item.error}>
                  <ErrorText message={item.error} files={[item.file]} />
                </span>
              ) : (
                <span className="text-xs text-muted tabular-nums">{formatBytes(item.file.size)}</span>
              )}
            </div>
            <StatusIcon item={item} />
            {reorderable ? (
              <div className="hidden shrink-0 sm:flex">
                <IconButton label={t("moveUp")} onClick={() => queue.move(i, i - 1)} disabled={i === 0 || queue.busy}>
                  <ArrowUp className="size-3.5" />
                </IconButton>
                <IconButton label={t("moveDown")} onClick={() => queue.move(i, i + 1)} disabled={i === queue.items.length - 1 || queue.busy}>
                  <ArrowDown className="size-3.5" />
                </IconButton>
              </div>
            ) : null}
            <IconButton label={t("remove")} onClick={() => queue.remove(item.id)} disabled={queue.busy}>
              <X className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dropzone + queue in one block: the standard "input" slot of a file tool. */
export function FileInput({
  queue,
  accept,
  formats,
  multiple = true,
  reorderable = false,
}: {
  queue: Queue;
  accept?: string;
  formats?: string;
  multiple?: boolean;
  reorderable?: boolean;
}) {
  const has = queue.items.length > 0;
  const slug = slugFromPath(usePath());
  // Files handed over from another tool, the home page or the OS ("Open with").
  useEffect(() => {
    const files = takeHandoff(slug).filter((f) => matchesAccept(f, accept));
    if (files.length) queue.add(multiple ? files : files.slice(0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Dropzone onFiles={queue.add} accept={accept} multiple={multiple} formats={formats} compact={has} />
      <QueueList queue={queue} reorderable={reorderable} />
    </div>
  );
}
