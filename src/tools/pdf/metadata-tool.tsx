import { useEffect, useState } from "react";
import { Eraser, Loader2 } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { META_FIELDS, readMeta, writeMeta, type PdfMeta } from "../../lib/pdf/edit";
import { errorMessage, useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pdfBlob } from "./common";
import { s } from "./strings";

const BLANK: PdfMeta = { title: "", author: "", subject: "", keywords: "", creator: "", producer: "" };

export default function MetadataTool({ meta: tool }: EngineProps) {
  const t = useT(s);
  const queue = useQueue({ multiple: false });
  const file = queue.items[0]?.file;
  const [meta, setMeta] = useState<PdfMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefill with what the file says today; saving is blocked until then.
  useEffect(() => {
    setMeta(null);
    setError(null);
    if (!file) return;
    let alive = true;
    file
      .arrayBuffer()
      .then(readMeta)
      .then(({ pages: _pages, ...m }) => alive && setMeta(m))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [file]);

  const run = () =>
    queue.runEach(async (f) => {
      if (!meta) throw new Error("Still reading the PDF");
      return { name: f.name, blob: pdfBlob(await writeMeta(await f.arrayBuffer(), meta)) };
    });

  const fields = !file ? (
    <Hint>{t("metaEmpty")}</Hint>
  ) : error ? (
    <p className="rounded-lg bg-err/10 px-3 py-2 text-xs text-err" role="alert">
      {error}
    </p>
  ) : !meta ? (
    <p className="flex items-center gap-2 text-xs text-muted">
      <Loader2 className="size-3.5 animate-spin" />
      {t("metaReading")}
    </p>
  ) : (
    <>
      {META_FIELDS.map((field) => (
        <TextField
          key={field}
          label={t(field)}
          value={meta[field]}
          onChange={(e) => setMeta({ ...meta, [field]: e.target.value })}
          placeholder={field === "keywords" ? t("keywordsHint") : undefined}
          data-testid={`meta-${field}`}
        />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Hint>{t("metaHint")}</Hint>
        <Button size="sm" variant="ghost" onClick={() => setMeta(BLANK)}>
          <Eraser className="size-3.5" />
          {t("clearFields")}
        </Button>
      </div>
    </>
  );

  return (
    <ToolLayout
      meta={tool}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" multiple={false} />}
      settings={fields}
      action={<RunButton queue={queue} onRun={run} label={t("saveRun")} disabled={!meta} />}
      results={<Results outputs={queue.outputs} />}
    />
  );
}
