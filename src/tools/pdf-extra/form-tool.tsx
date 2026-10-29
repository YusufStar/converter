import { Fragment, useEffect, useId, useState } from "react";
import { FileX2, Loader2, PenLine, RotateCcw } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { fillForm, readFormFields, type FieldValue, type FormField } from "../../lib/pdf-extra/form";
import { errorMessage, useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Panel, Segmented, Switch, TextField, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pdfBlob } from "../pdf/common";
import { LoadError, ToolLink } from "./common";
import { s } from "./strings";

type Values = Record<string, FieldValue>;

const initial = (fields: FormField[]): Values =>
  Object.fromEntries(fields.flatMap((f) => (f.kind === "signature" ? [] : [[f.name, f.value]])));

/** Toggle chips for dropdowns and lists (one or many picks). */
function Choices({ field, value, onChange }: { field: FormField & { options: string[]; multi: boolean }; value: string[]; onChange: (v: string[]) => void }) {
  const t = useT(s);
  return (
    <div role="group" aria-label={field.label} className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-surface-2 p-1.5">
      {field.options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            disabled={field.readOnly}
            onClick={() => onChange(field.multi ? (on ? value.filter((v) => v !== o) : [...value, o]) : on ? [] : [o])}
            className={cx(
              "min-h-8 max-w-full truncate rounded-lg px-2.5 text-[13px] font-medium transition duration-150 ease-out-soft disabled:opacity-45",
              on ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--accent)]" : "text-muted hover:text-fg",
            )}
          >
            {o || "—"}
          </button>
        );
      })}
      {!field.options.length ? <span className="px-2 py-1.5 text-xs text-muted">{t("noneSelected")}</span> : null}
    </div>
  );
}

function FieldRow({ field, value, onChange }: { field: FormField; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const t = useT(s);
  const id = useId();
  const head = (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <label htmlFor={id} className="min-w-0 truncate text-[13px] font-medium" title={field.name}>
        {field.label}
      </label>
      {field.readOnly && field.kind !== "signature" ? <span className="shrink-0 text-[11px] text-muted">{t("readOnly")}</span> : null}
    </div>
  );
  switch (field.kind) {
    case "text":
      return (
        <div className="flex min-w-0 flex-col gap-1.5">
          {head}
          {field.multiline ? (
            <textarea
              id={id}
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
              maxLength={field.maxLength}
              disabled={field.readOnly}
              rows={3}
              data-field={field.name}
              className="min-h-20 min-w-0 resize-y rounded-[10px] border border-line bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent disabled:opacity-60"
            />
          ) : (
            <TextField id={id} value={value as string} onChange={(e) => onChange(e.target.value)} maxLength={field.maxLength} disabled={field.readOnly} data-field={field.name} className="disabled:opacity-60" />
          )}
        </div>
      );
    case "checkbox":
      return (
        <div data-field={field.name} className={cx(field.readOnly && "pointer-events-none opacity-60")}>
          <Switch label={field.label} checked={value as boolean} onChange={onChange} hint={field.readOnly ? t("readOnly") : undefined} />
        </div>
      );
    case "radio":
      return (
        <div className="flex min-w-0 flex-col gap-1.5" data-field={field.name}>
          {head}
          <div className={cx(field.readOnly && "pointer-events-none opacity-60")}>
            <Segmented label={field.label} value={value as string} onChange={onChange} options={field.options.map((o) => ({ value: o, label: o }))} size="sm" />
          </div>
        </div>
      );
    case "dropdown":
    case "list":
      return (
        <div className="flex min-w-0 flex-col gap-1.5" data-field={field.name}>
          {head}
          <Choices field={field} value={value as string[]} onChange={onChange} />
        </div>
      );
    case "signature":
      return (
        <div className="flex min-w-0 items-start gap-3 rounded-xl border border-dashed border-line-strong px-3 py-2.5" data-field={field.name}>
          <PenLine className="mt-0.5 size-4 shrink-0 text-muted" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-medium">
              {t("sigField")} <span className="font-normal text-muted">· {field.label}</span>
            </span>
            <span className="text-xs leading-relaxed text-muted">
              {field.signed ? (
                t("sigFieldSigned")
              ) : (
                <>
                  {t("sigFieldEmpty")} <ToolLink slug="sign-pdf">{t("openSignPdf")}</ToolLink>
                </>
              )}
            </span>
          </div>
        </div>
      );
  }
}

export default function FormTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue({ multiple: false });
  const file = queue.items[0]?.file;
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [values, setValues] = useState<Values>({});
  const [error, setError] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(false);

  // Warm up pdf-lib while the visitor picks a file.
  useEffect(() => void import("pdf-lib"), []);

  useEffect(() => {
    setFields(null);
    setError(null);
    if (!file) return;
    let alive = true;
    file
      .arrayBuffer()
      .then(readFormFields)
      .then((list) => {
        if (!alive) return;
        setFields(list);
        setValues(initial(list));
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [file]);

  const run = () =>
    queue.runEach(async (f) => ({
      name: `${splitName(f.name).base}-filled.pdf`,
      blob: pdfBlob(await fillForm(await f.arrayBuffer(), values, { flatten })),
    }));

  const pages = fields ? [...new Set(fields.map((f) => f.page))] : [];
  const signed = fields?.some((f) => f.kind === "signature" && f.signed);

  const form = !file ? null : error ? (
    <LoadError message={error} />
  ) : !fields ? (
    <p className="flex items-center gap-2 px-1 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" />
      {t("reading")}
    </p>
  ) : !fields.length ? (
    <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-4" role="status" data-testid="no-form">
      <FileX2 className="mt-0.5 size-5 shrink-0 text-muted" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold">{t("noForm")}</p>
        <p className="text-sm text-muted">
          {t("noFormHint")} <ToolLink slug="sign-pdf">{t("openSignPdf")}</ToolLink>
        </p>
      </div>
    </div>
  ) : (
    <Panel
      title={
        <>
          {t("formFields")} <span className="font-normal text-muted">· {t("fieldCount", { n: fields.length })}</span>
        </>
      }
    >
      <div className="flex flex-col gap-5" data-testid="form-fields">
        {pages.map((page) => (
          <Fragment key={page}>
            {pages.length > 1 && page ? <h3 className="-mb-2 text-xs font-medium tracking-wide text-muted uppercase">{t("pageN", { n: page })}</h3> : null}
            {fields
              .filter((f) => f.page === page)
              .map((f) => (
                <FieldRow key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((m) => ({ ...m, [f.name]: v }))} />
              ))}
          </Fragment>
        ))}
      </div>
    </Panel>
  );

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" multiple={false} />
          {form}
        </div>
      }
      settings={
        <>
          <Switch label={t("flatten")} hint={t("flattenHint")} checked={flatten} onChange={setFlatten} />
          {signed ? <Hint tone="warn">{t("signedWarn")}</Hint> : null}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => fields && setValues(initial(fields))} disabled={!fields?.length}>
            <RotateCcw className="size-3.5" />
            {t("resetValues")}
          </Button>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={t("fillRun")} disabled={!fields?.length} />}
      results={<Results outputs={queue.outputs} />}
    />
  );
}
