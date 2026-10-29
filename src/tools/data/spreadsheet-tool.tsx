import { useState } from "react";
import { Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { localeOf } from "../../lib/langs";
import {
  TABLE_ACCEPT,
  TABLE_FORMATS,
  cellText,
  columnLetter,
  convertTable,
  effectiveMode,
  type Cell,
  type SheetMode,
  type TableFormat,
  type TableOptions,
} from "../../lib/data/table";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, Switch, TextField, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

interface Preset {
  from?: "excel" | "csv" | "json";
  to?: TableFormat;
}

const OUTPUTS = Object.keys(TABLE_FORMATS) as TableFormat[];
const PREVIEW_ROWS = 20;

interface PreviewSheet {
  label: string;
  rows: Cell[][];
  total: number;
}

function Preview({ sheets, header }: { sheets: PreviewSheet[]; header: boolean }) {
  const t = useT(s);
  const locale = localeOf(useLang());
  const [index, setIndex] = useState(0);
  const cur = sheets[Math.min(index, sheets.length - 1)];
  if (!cur) return null;
  const width = cur.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols = Array.from({ length: width }, (_, i) => i);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="preview">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold">{t("preview")}</h3>
        <span className="text-xs text-muted tabular-nums">
          {cur.total > cur.rows.length ? t("previewRows", { shown: cur.rows.length, total: cur.total.toLocaleString(locale) }) : t("previewAll", { total: cur.total.toLocaleString(locale) })}
        </span>
      </div>
      {sheets.length > 1 ? (
        <Segmented
          size="sm"
          label={t("previewSheet")}
          value={Math.min(index, sheets.length - 1)}
          onChange={setIndex}
          options={sheets.map((p, k) => ({ value: k, label: p.label, title: p.label }))}
        />
      ) : null}
      <div className="max-h-[440px] min-w-0 overflow-auto rounded-xl border border-line">
        <table className="w-max min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-surface-2 text-muted">
            <tr>
              <th className="sticky left-0 w-10 bg-surface-2 px-2 py-1.5 text-right font-mono font-medium" aria-hidden />
              {cols.map((c) => (
                <th key={c} className="border-l border-line px-2.5 py-1.5 text-center font-mono font-medium">
                  {columnLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cur.rows.map((r, ri) => (
              <tr key={ri} className={cx("border-t border-line", header && ri === 0 && "bg-accent-soft/40 font-semibold")}>
                <td className="sticky left-0 bg-surface-2 px-2 py-1.5 text-right font-mono text-muted tabular-nums">{ri + 1}</td>
                {cols.map((c) => {
                  const v = r[c] ?? null;
                  const text = cellText(v);
                  return (
                    <td
                      key={c}
                      title={text.length > 40 ? text : undefined}
                      className={cx("max-w-64 truncate border-l border-line px-2.5 py-1.5", typeof v === "number" && "text-right tabular-nums")}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SpreadsheetTool({ meta }: EngineProps) {
  const t = useT(s);
  const locale = localeOf(useLang());
  const preset = (meta.preset ?? {}) as Preset;
  const queue = useQueue();
  const [o, setO] = useState<TableOptions>(() => ({
    to: preset.to ?? "xlsx",
    sheets: "combined",
    header: true,
    delimiter: ",",
    quoteAll: false,
    bom: true,
    pretty: true,
    table: "",
    isoDates: true,
  }));
  const [preview, setPreview] = useState<PreviewSheet[]>([]);
  const set = (p: Partial<TableOptions>) => setO((prev) => ({ ...prev, ...p }));

  const fmt = TABLE_FORMATS[o.to];
  const mode = effectiveMode(o.sheets, o.to);
  const keyed = o.to === "json" || o.to === "yaml";
  const sheetsHint =
    mode === "first"
      ? t("sheetsHintFirst")
      : mode === "each"
        ? fmt.multi
          ? t("sheetsHintEach")
          : t("sheetsHintEachForced", { format: fmt.label })
        : keyed
          ? t("sheetsHintKeyed")
          : t("sheetsHintCombined");
  const isCsv = o.to === "csv" || o.to === "tsv";
  const jsonInput = !preset.from || preset.from === "json" || queue.items.some((it) => /\.(json|jsonl|ndjson)$/i.test(it.file.name));

  const run = () => {
    const files = queue.items.map((it) => it.file);
    const found: PreviewSheet[][] = [];
    setPreview([]);
    return queue.runEach(async (file) => {
      const { outputs, sheets } = await convertTable(file.name, new Uint8Array(await file.arrayBuffer()), o);
      found[files.indexOf(file)] = sheets.map((sh) => ({
        label: sheets.length > 1 ? (files.length > 1 ? `${file.name} · ${sh.name}` : sh.name) : file.name,
        rows: sh.rows.slice(0, PREVIEW_ROWS),
        total: sh.rows.length,
      }));
      setPreview(found.flat().filter(Boolean).slice(0, 12));
      // Size deltas between formats (CSV vs XLSX) mean nothing, so no sourceSize.
      return outputs.map((out) => ({ name: out.name, blob: out.blob, sourceSize: undefined, note: t("rowsNote", { n: out.rows.toLocaleString(locale) }) }));
    }, 2);
  };

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={TABLE_ACCEPT} formats="XLSX, XLS, ODS, CSV, TSV, JSON, HTML, XML" />}
      settings={
        <>
          <Field label={t("output")}>
            <Segmented
              label={t("output")}
              value={o.to}
              onChange={(to) => set({ to })}
              columns={5}
              size="sm"
              options={OUTPUTS.map((f) => ({ value: f, label: f === "md" ? "MD" : TABLE_FORMATS[f].label, title: TABLE_FORMATS[f].label }))}
            />
          </Field>

          <Field label={t("sheets")} hint={sheetsHint}>
            <Segmented<SheetMode>
              label={t("sheets")}
              value={mode}
              onChange={(sheets) => set({ sheets })}
              columns={3}
              size="sm"
              options={[
                { value: "first", label: t("sheetsFirst"), title: t("sheetsHintFirst") },
                { value: "each", label: t("sheetsEach"), title: t("sheetsHintEach") },
                { value: "combined", label: keyed ? t("sheetsKeyed") : t("sheetsCombined"), disabled: !fmt.multi },
              ]}
            />
          </Field>

          {!isCsv ? <Switch checked={o.header} onChange={(header) => set({ header })} label={t("header")} hint={t("headerHint")} /> : null}

          {o.to === "csv" ? (
            <Field label={t("delimiter")}>
              <Segmented
                label={t("delimiter")}
                value={o.delimiter}
                onChange={(delimiter) => set({ delimiter })}
                columns={4}
                size="sm"
                options={[
                  { value: ",", label: ",", title: t("comma") },
                  { value: ";", label: ";", title: t("semicolon") },
                  { value: "\t", label: t("tab"), title: t("tab") },
                  { value: "|", label: "|", title: t("pipe") },
                ]}
              />
            </Field>
          ) : null}

          {isCsv ? (
            <>
              <Field label={t("quoting")}>
                <Segmented
                  label={t("quoting")}
                  value={o.quoteAll ? "all" : "auto"}
                  onChange={(v) => set({ quoteAll: v === "all" })}
                  columns={2}
                  size="sm"
                  options={[
                    { value: "auto", label: t("quoteAuto") },
                    { value: "all", label: t("quoteAll") },
                  ]}
                />
              </Field>
              <Switch checked={o.bom} onChange={(bom) => set({ bom })} label={t("bom")} hint={t("bomHint")} />
            </>
          ) : null}

          {o.to === "json" ? <Switch checked={o.pretty} onChange={(pretty) => set({ pretty })} label={t("pretty")} hint={t("prettyHint")} /> : null}

          {o.to === "sql" ? <TextField label={t("table")} value={o.table} placeholder={t("tablePlaceholder")} onChange={(e) => set({ table: e.target.value })} /> : null}

          <Switch checked={o.isoDates} onChange={(isoDates) => set({ isoDates })} label={t("isoDates")} hint={t("isoDatesHint")} />

          {jsonInput ? (
            <p className="flex gap-2 text-xs leading-relaxed text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{t("nested")}</span>
            </p>
          ) : null}
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("convertN", { n }) : t("convertOne")} />}
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`}>
          {preview.length ? <Preview sheets={preview} header={o.header} /> : null}
        </Results>
      }
    />
  );
}
