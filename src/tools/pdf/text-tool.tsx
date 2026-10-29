import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { EngineProps } from "../../engines";
import { withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { pageSelection } from "../../lib/pdf/ranges";
import { closePdf, openFile, pageText } from "../../lib/pdf/pdfjs";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Segmented, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { ui } from "../../ui/strings";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, PageScope, pagesLabel, scopeInvalid, scopeRanges, zipNameFor, type Scope } from "./common";
import { s } from "./strings";

const PREVIEW_MAX = 200_000;

export default function TextTool({ meta }: EngineProps) {
  const t = useT(s);
  const tu = useT(ui);
  const queue = useQueue();
  const [scope, setScope] = useState<Scope>({ all: true, ranges: "" });
  const [breaks, setBreaks] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  // Results whose PDF had no text layer at all (scans).
  const empty = useRef(new WeakSet<Blob>());
  const n = queue.items.length;
  const current = queue.outputs.find((o) => o.id === selected) ?? queue.outputs[0];

  useEffect(() => {
    let alive = true;
    setText("");
    current?.blob.text().then((v) => alive && setText(v));
    return () => {
      alive = false;
    };
  }, [current]);

  const run = () =>
    queue.runEach(async (file, ctx) => {
      const doc = await openFile(file);
      try {
        const only = pageSelection(scopeRanges(scope), doc.numPages);
        const list = only ? [...only].sort((a, b) => a - b) : [...Array(doc.numPages).keys()];
        const chunks: string[] = [];
        let chars = 0;
        for (const [k, i] of list.entries()) {
          ctx.signal.throwIfAborted();
          const page = await doc.getPage(i + 1);
          const body = await pageText(page);
          page.cleanup();
          chars += body.length;
          chunks.push(breaks ? `${t("pageMarker", { n: i + 1 })}\n\n${body}` : body);
          ctx.progress((k + 1) / list.length);
        }
        const out = chunks.join("\n\n").trim() + "\n";
        const words = out.match(/\S+/g)?.length ?? 0;
        const blob = new Blob([out], { type: "text/plain;charset=utf-8" });
        if (!chars) empty.current.add(blob);
        return {
          name: withExt(file.name, "txt"),
          blob,
          note: !chars ? t("noText") : `${pagesLabel(t, list.length)} · ${t("words", { n: words.toLocaleString() })}`,
          sourceSize: undefined,
        };
      } finally {
        await closePdf(doc);
      }
    });

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const noText = current !== undefined && empty.current.has(current.blob);

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          <PageScope value={scope} onChange={setScope} />
          <Switch checked={breaks} onChange={setBreaks} label={t("pageBreaks")} hint={t("pageBreaksHint")} />
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("textRunN", { n }) : t("textRun")} disabled={scopeInvalid(scope)} />}
      results={
        <Results
          outputs={queue.outputs}
          zipName={zipNameFor(queue, meta.slug)}
          extra={
            current ? (
              <Button onClick={copy} disabled={!text.trim()} data-testid="copy-text">
                {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
                {copied ? tu("copied") : tu("copy")}
              </Button>
            ) : null
          }
        >
          {current ? (
            <div className="flex min-w-0 flex-col gap-3">
              <h3 className="text-[13px] font-medium">{t("textPreview")}</h3>
              {queue.outputs.length > 1 ? (
                <Segmented label={t("textPreview")} value={current.id} onChange={setSelected} size="sm" options={queue.outputs.map((o) => ({ value: o.id, label: o.name, title: o.name }))} />
              ) : null}
              {noText ? (
                <Hint tone="warn">{t("noTextLong")}</Hint>
              ) : (
                <pre
                  data-testid="text-preview"
                  className="max-h-[420px] min-h-24 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap"
                >
                  {text.slice(0, PREVIEW_MAX)}
                </pre>
              )}
              {text.length > PREVIEW_MAX ? <Hint>{t("truncated", { n: PREVIEW_MAX.toLocaleString() })}</Hint> : null}
            </div>
          ) : null}
        </Results>
      }
    />
  );
}
