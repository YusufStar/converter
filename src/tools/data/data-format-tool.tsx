import { useEffect, useState } from "react";
import { ArrowDownUp, Check, CircleCheck, Copy, Download, Info, Sparkles } from "lucide-react";
import type { EngineProps } from "../../engines";
import { decodeText } from "../../lib/data/csv";
import { DATA_FORMATS, convertData, formatFromName, stringifyData, type DataFormat, type Indent } from "../../lib/data/structured";
import { downloadBlob } from "../../lib/download";
import { splitName } from "../../lib/files";
import { useLang, useT } from "../../lib/i18n";
import { localeOf } from "../../lib/langs";
import { errorMessage, useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Field, IconButton, Segmented, Switch, TextArea } from "../../ui/kit";
import { Results } from "../../ui/results";
import { ui } from "../../ui/strings";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

interface Preset {
  from?: DataFormat;
  to?: DataFormat;
  /** JSON formatter / validator: JSON in, JSON out, no format pickers. */
  formatter?: boolean;
}

const ORDER: DataFormat[] = ["json", "yaml", "xml", "toml"];

const SAMPLE = {
  name: "Converter",
  version: 2,
  private: true,
  tags: ["csv", "json", "yaml"],
  owner: { name: "Ayşe Yılmaz", city: "İstanbul" },
  releases: [
    { tag: "v1.0", date: "2026-01-15" },
    { tag: "v2.0", date: "2026-09-01" },
  ],
};

type Out = { text: string; error: null } | { text: null; error: string };

export default function DataFormatTool({ meta }: EngineProps) {
  const t = useT(s);
  const locale = localeOf(useLang());
  const tu = useT(ui);
  const preset = (meta.preset ?? {}) as Preset;
  const formatter = !!preset.formatter;
  const queue = useQueue();
  const [mode, setMode] = useState<"paste" | "files">("paste");
  const [from, setFrom] = useState<DataFormat>(preset.from ?? "json");
  const [to, setTo] = useState<DataFormat>(preset.to ?? (formatter ? "json" : "yaml"));
  const [indent, setIndent] = useState<Indent>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [text, setText] = useState("");
  const [out, setOut] = useState<Out | null>(null);
  const [copied, setCopied] = useState(false);

  // YAML can't be indented with tabs or minified.
  const effIndent: Indent = to === "yaml" && (indent === "tab" || indent === 0) ? 2 : indent;
  const opts = { indent: effIndent, sortKeys };

  useEffect(() => {
    if (mode !== "paste") return;
    if (!text.trim()) {
      setOut(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      convertData(text, from, to, { indent: effIndent, sortKeys }).then(
        (r) => live && setOut({ text: r, error: null }),
        (e) => live && setOut({ text: null, error: errorMessage(e) }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [text, from, to, effIndent, sortKeys, mode]);

  const swap = () => {
    setFrom(to);
    setTo(from);
    if (out?.text) setText(out.text);
  };

  const sample = async () => setText(await stringifyData(from === "xml" ? { project: SAMPLE } : SAMPLE, from, { indent: 2, sortKeys: false }));

  const copy = async () => {
    if (!out?.text) return;
    try {
      await navigator.clipboard.writeText(out.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure context / permissions): nothing to do
    }
  };

  const outExt = (base?: string) => (formatter && indent === 0 && !base?.endsWith(".min") ? "min.json" : DATA_FORMATS[to].ext);
  const mime = `${DATA_FORMATS[to].mime};charset=utf-8`;

  const download = () => out?.text && downloadBlob(new Blob([out.text], { type: mime }), `data.${outExt()}`);

  const run = () =>
    queue.runEach(async (file) => {
      const src = formatFromName(file.name) ?? from;
      const result = await convertData(decodeText(new Uint8Array(await file.arrayBuffer())), src, to, opts);
      const { base } = splitName(file.name);
      return { name: `${base}.${outExt(base)}`, blob: new Blob([result], { type: mime }) };
    }, 4);

  const fromLabel = DATA_FORMATS[from].label;
  const n = queue.items.length;

  const indentField =
    to === "toml" ? null : (
      <Field label={t("indent")} hint={to === "yaml" ? t("yamlNote") : undefined}>
        <Segmented<Indent>
          label={t("indent")}
          value={effIndent}
          onChange={setIndent}
          columns={4}
          size="sm"
          options={[
            { value: 2, label: t("spaces2") },
            { value: 4, label: t("spaces4") },
            { value: "tab", label: t("tabIndent"), disabled: to === "yaml" },
            { value: 0, label: t("minify"), disabled: to === "yaml" },
          ]}
        />
      </Field>
    );

  const note = to === "toml" ? t("tomlNote") : from === "xml" || to === "xml" ? t("xmlNote") : null;

  const formatOptions = ORDER.map((f) => ({ value: f, label: DATA_FORMATS[f].label }));

  const settings = (
    <>
      {formatter ? null : (
        <div className="flex flex-col gap-2">
          <Field label={t("from")}>
            <Segmented label={t("from")} value={from} onChange={setFrom} columns={4} size="sm" options={formatOptions} />
          </Field>
          <div className="flex justify-center">
            <IconButton label={t("swap")} onClick={swap} data-testid="swap">
              <ArrowDownUp className="size-4" />
            </IconButton>
          </div>
          <Field label={t("to")}>
            <Segmented label={t("to")} value={to} onChange={setTo} columns={4} size="sm" options={formatOptions} />
          </Field>
        </div>
      )}
      {indentField}
      <Switch checked={sortKeys} onChange={setSortKeys} label={t("sortKeys")} hint={t("sortKeysHint")} />
      {note || mode === "files" ? (
        <p className="flex gap-2 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {note}
            {note && mode === "files" ? " " : ""}
            {mode === "files" && !formatter ? t("detectNote", { format: fromLabel }) : ""}
          </span>
        </p>
      ) : null}
    </>
  );

  const status = out?.error ? (
    <pre role="alert" data-testid="paste-error" className="overflow-x-auto rounded-lg bg-err/10 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-err">
      {out.error}
    </pre>
  ) : out?.text != null ? (
    <p className="flex items-center gap-1.5 text-xs text-ok" data-testid="paste-valid">
      <CircleCheck className="size-3.5" />
      {t("valid", { format: fromLabel })}
      <span className="text-muted tabular-nums">· {t("chars", { n: text.length.toLocaleString(locale) })}</span>
    </p>
  ) : null;

  const input = (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="max-w-64">
        <Segmented
          label={t("modeLabel")}
          value={mode}
          onChange={setMode}
          columns={2}
          options={[
            { value: "paste", label: t("modePaste") },
            { value: "files", label: t("modeFiles") },
          ]}
        />
      </div>
      {mode === "paste" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <TextArea
            label={`${t("input")} · ${fromLabel}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("pastePlaceholder", { format: fromLabel })}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-h-64 sm:min-h-80"
            data-testid="paste-input"
          />
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">{status}</div>
            {!text ? (
              <Button size="sm" variant="ghost" onClick={sample}>
                <Sparkles className="size-3.5" />
                {t("sample")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <FileInput queue={queue} accept=".json,.yaml,.yml,.xml,.toml,.txt,.geojson,.webmanifest" formats="JSON, YAML, XML, TOML" />
      )}
    </div>
  );

  const pasteOutput = (
    <section className="min-w-0 rounded-2xl border border-line bg-surface" data-testid="paste-output">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">
          {t("outputText")} <span className="font-normal text-muted">· {DATA_FORMATS[to].label}</span>
        </h2>
        <div className="flex gap-2">
          <Button size="sm" onClick={copy} disabled={!out?.text} data-testid="copy">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? tu("copied") : tu("copy")}
          </Button>
          <Button size="sm" variant="primary" onClick={download} disabled={!out?.text} data-testid="download-text">
            <Download className="size-3.5" />
            {tu("download")}
          </Button>
        </div>
      </header>
      <div className="p-3">
        <TextArea
          readOnly
          aria-label={t("outputText")}
          value={out?.text ?? ""}
          placeholder={t("emptyOutput")}
          spellCheck={false}
          className="min-h-64 bg-surface-2/50 sm:min-h-80"
          data-testid="paste-result"
        />
      </div>
    </section>
  );

  return (
    <ToolLayout
      meta={meta}
      input={input}
      settings={settings}
      action={
        mode === "files" ? (
          <RunButton
            queue={queue}
            onRun={run}
            label={formatter ? (n > 1 ? t("formatN", { n }) : t("format")) : n > 1 ? t("convertN", { n }) : t("convertOne")}
          />
        ) : undefined
      }
      results={mode === "paste" ? pasteOutput : <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
