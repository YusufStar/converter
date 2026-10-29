import { useEffect, useState } from "react";
import { Check, ClipboardPaste, Copy, Files, Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName, withExt } from "../../lib/files";
import { useLang, useT } from "../../lib/i18n";
import { localeOf } from "../../lib/langs";
import { convertDocument, EXT, type DocFrom, type DocTo } from "../../lib/document/convert";
import { DEFAULT_PDF, type Margins, type PageSize, type PdfOptions } from "../../lib/document/html-to-pdf";
import { useQueue, type Output } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Field, Segmented, Slider, Switch, TextArea, TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { ui } from "../../ui/strings";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

interface Preset {
  from: DocFrom;
  to: DocTo;
}

const INPUT: Record<DocFrom, { accept: string; label: string; ext: string }> = {
  docx: { accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX", ext: "docx" },
  md: { accept: ".md,.markdown,.mdown,.mkd,.mdx,.txt,text/markdown", label: "MD, MARKDOWN, TXT", ext: "md" },
  html: { accept: ".html,.htm,.xhtml,text/html", label: "HTML, HTM, XHTML", ext: "html" },
  txt: {
    accept: ".txt,.text,.log,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.ini,.conf,.cfg,.sql,.sh,.py,.js,.ts,.css,text/plain",
    label: "TXT, LOG, MD, CSV, JSON, XML, YAML, code",
    ext: "txt",
  },
};

const RUN_LABEL = { pdf: "toPdf", html: "toHtml", txt: "toTxt", md: "toMd" } as const;
const PREVIEW_LIMIT = 100_000;

function OutputPreview({ output, kind }: { output: Output; kind: DocTo }) {
  const t = useT(s);
  const locale = localeOf(useLang());
  const tu = useT(ui);
  const [text, setText] = useState<string | null>(null);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null);
    output.blob.text().then((v) => live && setText(v));
    return () => {
      live = false;
    };
  }, [output.blob]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  if (text === null) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard blocked (permissions / insecure context): the download still works.
    }
  };
  const shown = text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {kind === "html" ? (
          <div className="w-44">
            <Segmented
              label={t("preview")}
              value={view}
              onChange={setView}
              size="sm"
              options={[
                { value: "preview", label: t("preview") },
                { value: "code", label: t("code") },
              ]}
            />
          </div>
        ) : (
          <span className="truncate text-xs font-medium text-muted">{t("previewTitle", { name: output.name })}</span>
        )}
        <Button size="sm" onClick={copy} data-testid="copy">
          {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          {copied ? tu("copied") : tu("copy")}
        </Button>
      </div>
      {kind === "html" && view === "preview" ? (
        <iframe
          title={t("previewTitle", { name: output.name })}
          sandbox=""
          srcDoc={text}
          className="h-[min(560px,70vh)] w-full rounded-xl border border-line bg-white"
          data-testid="html-preview"
        />
      ) : (
        <TextArea readOnly value={shown} rows={14} spellCheck={false} aria-label={t("previewTitle", { name: output.name })} className="min-h-72" data-testid="text-preview" />
      )}
      {shown !== text ? <p className="text-xs text-muted">{t("truncated", { n: PREVIEW_LIMIT.toLocaleString(locale) })}</p> : null}
    </div>
  );
}

export default function DocumentTool({ meta }: EngineProps) {
  const t = useT(s);
  const locale = localeOf(useLang());
  const tu = useT(ui);
  const { from, to } = meta.preset as unknown as Preset;
  const input = INPUT[from];
  const canPaste = from !== "docx";

  const files = useQueue();
  const pasted = useQueue({ multiple: false });
  const [mode, setMode] = useState<"files" | "paste">("files");
  const [text, setText] = useState("");
  const pasting = canPaste && mode === "paste";
  const queue = pasting ? pasted : files;

  const [pdf, setPdf] = useState<PdfOptions>(DEFAULT_PDF);
  const [font, setFont] = useState<"sans" | "mono">("sans");
  const setP = (p: Partial<PdfOptions>) => setPdf((prev) => ({ ...prev, ...p }));

  const onText = (v: string) => {
    setText(v);
    // The pasted text becomes a one-file queue, so both modes share the same run + results.
    if (v.trim()) pasted.add([new File([v], `document.${input.ext}`, { type: "text/plain" })]);
    else pasted.clear();
  };

  const run = () =>
    queue.runEach(async (file, ctx) => {
      ctx.progress(0.15);
      const r = await convertDocument(await file.arrayBuffer(), from, to, splitName(file.name).base, { pdf, font });
      return {
        name: withExt(file.name, EXT[to]),
        blob: r.blob,
        // "625% larger" means nothing across document formats: hide the size delta.
        sourceSize: undefined,
        note: r.pages ? (r.pages === 1 ? t("onePage") : t("pages", { n: r.pages })) : undefined,
      };
    });

  const note = to === "pdf" ? t("pdfNote") : to === "html" ? t("htmlNote") : to === "md" ? t("mdNote") : from === "docx" ? t("docxTxtNote") : t("txtNote");
  const pasteError = pasted.items[0]?.status === "error" ? pasted.items[0].error : undefined;
  const first = queue.outputs[0];

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          {canPaste ? (
            <div className="sm:max-w-72">
              <Segmented
                label={t("source")}
                value={mode}
                onChange={setMode}
                options={[
                  {
                    value: "files",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Files className="size-3.5" />
                        {t("files")}
                      </span>
                    ),
                  },
                  {
                    value: "paste",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <ClipboardPaste className="size-3.5" />
                        {t("paste")}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          ) : null}
          {pasting ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <TextArea
                label={t("pasteLabel")}
                value={text}
                onChange={(e) => onText(e.target.value)}
                placeholder={from === "md" ? t("placeholderMd") : from === "html" ? t("placeholderHtml") : t("placeholderTxt")}
                spellCheck={false}
                className="min-h-72"
                data-testid="paste-input"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted tabular-nums">
                <span>{t("chars", { n: text.length.toLocaleString(locale) })}</span>
                {pasteError ? (
                  <span className="text-err" role="alert">
                    {pasteError}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <FileInput queue={files} accept={input.accept} formats={input.label} />
          )}
          {from === "docx" ? <p className="text-xs leading-relaxed text-muted">{t("docxOnly")}</p> : null}
        </div>
      }
      settings={
        <>
          {to === "pdf" ? (
            <>
              <Field label={t("pageSize")}>
                <Segmented<PageSize>
                  label={t("pageSize")}
                  value={pdf.pageSize}
                  onChange={(pageSize) => setP({ pageSize })}
                  columns={3}
                  options={[
                    { value: "a4", label: "A4" },
                    { value: "letter", label: "Letter" },
                    { value: "legal", label: "Legal" },
                  ]}
                />
              </Field>
              <Field label={t("margins")}>
                <Segmented<Margins>
                  label={t("margins")}
                  value={pdf.margins}
                  onChange={(margins) => setP({ margins })}
                  columns={3}
                  options={[
                    { value: "narrow", label: t("narrow") },
                    { value: "normal", label: t("normal") },
                    { value: "wide", label: t("wide") },
                  ]}
                />
              </Field>
              {from === "txt" ? (
                <Field label={t("font")}>
                  <Segmented
                    label={t("font")}
                    value={font}
                    onChange={setFont}
                    columns={2}
                    options={[
                      { value: "sans", label: t("sans") },
                      { value: "mono", label: t("mono") },
                    ]}
                  />
                </Field>
              ) : null}
              <Slider label={t("fontSize")} value={pdf.fontSize} onChange={(fontSize) => setP({ fontSize })} min={8} max={18} step={0.5} suffix=" pt" />
              <Switch checked={pdf.pageNumbers} onChange={(pageNumbers) => setP({ pageNumbers })} label={t("pageNumbers")} hint={t("pageNumbersHint")} />
              {from !== "txt" ? (
                <Switch checked={pdf.underlineLinks} onChange={(underlineLinks) => setP({ underlineLinks })} label={t("underlineLinks")} hint={t("underlineLinksHint")} />
              ) : null}
              <Field label={t("title")} hint={t("titleHint")}>
                <TextField value={pdf.title} onChange={(e) => setP({ title: e.target.value })} placeholder={t("titlePlaceholder")} aria-label={t("title")} />
              </Field>
            </>
          ) : null}
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{note}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={t(RUN_LABEL[to])} emptyLabel={pasting ? tu("pasteFirst") : undefined} />}
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {first && to !== "pdf" ? <OutputPreview key={first.id} output={first} kind={to} /> : null}
        </Results>
      }
    />
  );
}
