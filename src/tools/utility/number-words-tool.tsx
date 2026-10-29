import { useState } from "react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { MAX_DIGITS, normalizeDecimal, numberToWords, type WordsLang } from "../../lib/utility/number-words";
import { Segmented, Switch, TextField } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { ListCard, Note, ValueRow } from "./shared";
import { wordStrings } from "./strings";

export default function NumberWordsTool({ meta }: EngineProps) {
  const t = useT(wordStrings);
  const uiLang = useLang();
  const [text, setText] = useState("1234.56");
  // Spelled-out numbers exist in English and Turkish only.
  const [lang, setLang] = useState<WordsLang>(uiLang === "tr" ? "tr" : "en");
  const [currency, setCurrency] = useState(false);

  const normalized = normalizeDecimal(text, lang);
  const tooLarge = normalized !== null && normalized.replace(/^-/, "").split(".")[0].length > MAX_DIGITS;
  const words = normalized && !tooLarge ? numberToWords(normalized, lang, { currency }) : null;
  const error = !text.trim() ? null : tooLarge ? t("tooLarge") : normalized === null ? t("invalid") : null;

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
            inputMode="decimal"
            autoComplete="off"
            className="h-12 font-mono text-lg"
            aria-invalid={!!error}
            data-testid="words-input"
          />
          {error ? <Note tone="err">{error}</Note> : <Note>{t("separators")}</Note>}
        </section>
      }
      settings={
        <>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">{t("language")}</span>
            <Segmented<WordsLang>
              label={t("language")}
              value={lang}
              onChange={setLang}
              size="sm"
              options={[
                { value: "en", label: t("english") },
                { value: "tr", label: t("turkish") },
              ]}
            />
          </div>
          <Switch checked={currency} onChange={setCurrency} label={t("currency")} hint={t("currencyHint")} />
        </>
      }
      results={
        words ? (
          <ListCard testId="words-results">
            <div className="divide-y divide-line">
              <ValueRow label={t("words")} value={words} mono={false} testId="words-out" />
              <ValueRow label={t("wordsUpper")} value={words.toLocaleUpperCase(lang)} mono={false} />
            </div>
          </ListCard>
        ) : null
      }
    />
  );
}
