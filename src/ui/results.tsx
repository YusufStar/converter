import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, Download, FileIcon, Loader2 } from "lucide-react";
import { downloadBlob, downloadZip } from "../lib/download";
import { formatBytes, sizeDelta } from "../lib/files";
import { useT } from "../lib/i18n";
import type { Output } from "../lib/use-queue";
import { Button, cx } from "./kit";
import { ui } from "./strings";

const IMAGE_PREVIEW = /^image\/(png|jpeg|webp|avif|gif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;

function Preview({ output }: { output: Output }) {
  const show = IMAGE_PREVIEW.test(output.blob.type) && output.blob.size < 40e6;
  const url = useMemo(() => (show ? URL.createObjectURL(output.blob) : null), [output.blob, show]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <span className="checker flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line">
      {url ? <img src={url} alt="" decoding="async" className="size-full object-contain" /> : <FileIcon className="size-5 text-muted" />}
    </span>
  );
}

function Delta({ before, after }: { before?: number; after: number }) {
  const t = useT(ui);
  if (!before) return null;
  const d = sizeDelta(before, after);
  if (d === 0) return <span className="text-muted">{t("sameSize")}</span>;
  return d < 0 ? (
    <span className="font-medium text-ok">{t("smaller", { n: -d })}</span>
  ) : (
    <span className="text-muted">{t("larger", { n: d })}</span>
  );
}

/**
 * Output list. One output → a single big Download button; several → each row
 * has its own button and "Download all" zips them on click.
 */
export function Results({
  outputs,
  zipName = "converted.zip",
  extra,
  children,
}: {
  outputs: Output[];
  zipName?: string;
  /** Extra header actions (e.g. "Copy text"). */
  extra?: ReactNode;
  /** Optional custom preview area under the list (text output etc.). */
  children?: ReactNode;
}) {
  const t = useT(ui);
  const [zipping, setZipping] = useState(false);
  if (!outputs.length) return null;

  const total = outputs.reduce((a, o) => a + o.blob.size, 0);
  const many = outputs.length > 1;

  const zipAll = async () => {
    setZipping(true);
    try {
      await downloadZip(outputs, zipName);
    } finally {
      setZipping(false);
    }
  };

  return (
    <section className="min-w-0 animate-rise rounded-2xl border border-line bg-surface" data-testid="results" aria-live="polite">
      <header className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold">
          {t("results")} <span className="font-normal text-muted">· {t("filesCount", { n: outputs.length, size: formatBytes(total) })}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          {many ? (
            <Button variant="primary" onClick={zipAll} disabled={zipping} data-testid="download-all">
              {zipping ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
              {zipping ? t("zipping") : t("downloadAll")}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => downloadBlob(outputs[0].blob, outputs[0].name)} data-testid="download">
              <Download className="size-4" />
              {t("download")}
            </Button>
          )}
        </div>
      </header>
      <ul className={cx("divide-y divide-line", many && "max-h-[520px] overflow-y-auto")}>
        {outputs.map((o) => (
          <li key={o.id} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            <Preview output={o} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium" title={o.name}>
                {o.name}
              </span>
              <span className="flex flex-wrap gap-x-2 text-xs text-muted tabular-nums">
                <span>{formatBytes(o.blob.size)}</span>
                {o.width && o.height ? (
                  <span>
                    {o.width}×{o.height}
                  </span>
                ) : null}
                <Delta before={o.sourceSize} after={o.blob.size} />
                {o.note ? <span>{o.note}</span> : null}
              </span>
            </div>
            <Button size="sm" variant={many ? "secondary" : "ghost"} onClick={() => downloadBlob(o.blob, o.name)} aria-label={`${t("download")} ${o.name}`}>
              <Download className="size-3.5" />
              <span className="hidden sm:inline">{t("download")}</span>
            </Button>
          </li>
        ))}
      </ul>
      {children ? <div className="border-t border-line p-4">{children}</div> : null}
    </section>
  );
}
