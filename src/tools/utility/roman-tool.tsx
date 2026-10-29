import { useState } from "react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { fromRoman, romanParts, toRoman } from "../../lib/utility/roman";
import { Switch, TextField } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { ListCard, Note, ValueRow } from "./shared";
import { romanStrings } from "./strings";

export default function RomanTool({ meta }: EngineProps) {
  const t = useT(romanStrings);
  const lang = useLang();
  const [text, setText] = useState("2026");
  const [lower, setLower] = useState(false);

  const isNumber = /^\s*\d[\d.,\s]*$/.test(text);
  const n = isNumber ? Number(text.replace(/[.,\s]/g, "")) : fromRoman(text);
  const upper = n === null ? null : toRoman(n);
  const roman = upper && lower ? upper.toLowerCase() : upper;
  const ok = roman !== null && n !== null;
  const error = !text.trim() || ok ? null : isNumber ? t("invalidNumber") : t("invalidRoman");

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <TextField
            label={t("input")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("placeholder")}
            autoComplete="off"
            spellCheck={false}
            className="h-12 font-mono text-lg uppercase"
            aria-invalid={!!error}
            data-testid="roman-input"
          />
          {error ? <Note tone="err">{error}</Note> : <Note>{t("accepts")}</Note>}
        </section>
      }
      settings={
        <>
          <Switch checked={lower} onChange={setLower} label={t("lower")} hint={t("lowerHint")} />
          <Note>{t("rules")}</Note>
        </>
      }
      results={
        ok ? (
          <ListCard testId="roman-results">
            <div className="divide-y divide-line">
              <ValueRow label={t("toRoman")} value={roman} testId="roman-out" />
              <ValueRow label={t("toNumber")} value={new Intl.NumberFormat(lang).format(n)} copy={String(n)} testId="roman-number" />
            </div>
            <div className="flex flex-col gap-2 border-t border-line p-4">
              <span className="text-xs font-medium text-muted">{t("breakdown")}</span>
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-sm">
                {romanParts(n).map(([v, s], i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i ? <span className="text-muted">+</span> : null}
                    <span className="rounded-lg bg-surface-2 px-2 py-1">
                      <span className="font-semibold">{lower ? s.toLowerCase() : s}</span> <span className="text-muted">{v}</span>
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </ListCard>
        ) : null
      }
    />
  );
}
