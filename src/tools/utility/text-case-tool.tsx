import { useState } from "react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { CASES, convertCase, textStats } from "../../lib/utility/text-case";
import { Switch, TextArea } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { CopyButton, Note, Stat } from "./shared";
import { caseStrings } from "./strings";

export default function TextCaseTool({ meta }: EngineProps) {
  const t = useT(caseStrings);
  const lang = useLang();
  const [text, setText] = useState(() => t("sample"));
  // null = follow the UI language.
  const [turkishPick, setTurkish] = useState<boolean | null>(null);
  const [ascii, setAscii] = useState(false);
  const turkish = turkishPick ?? lang === "tr";
  const stats = textStats(text, lang);
  const nf = new Intl.NumberFormat(lang);

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <TextArea
            label={t("input")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("placeholder")}
            className="min-h-36 font-sans text-sm"
            data-testid="case-input"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="case-stats">
            {(["characters", "noSpaces", "words", "sentences", "lines", "bytes"] as const).map((k) => (
              <Stat key={k} label={t(k)} value={nf.format(stats[k])} />
            ))}
          </div>
        </section>
      }
      settings={
        <>
          <Switch checked={turkish} onChange={setTurkish} label={t("turkish")} hint={t("turkishHint")} />
          <Switch checked={ascii} onChange={setAscii} label={t("ascii")} hint={t("asciiHint")} />
          <Note>{t("perLine")}</Note>
        </>
      }
      results={
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {CASES.map((id) => {
            const out = convertCase(text, id, { turkish, ascii });
            return (
              <section key={id} className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface" data-testid={`case-${id}`}>
                <header className="flex items-center justify-between gap-2 py-1.5 pr-1.5 pl-4">
                  <h2 className="truncate font-mono text-xs font-medium text-muted">{t(id)}</h2>
                  <CopyButton value={out} label={t(id)} />
                </header>
                <p className="max-h-40 min-h-12 overflow-y-auto border-t border-line px-4 py-3 text-sm break-words whitespace-pre-wrap" data-testid={`case-out-${id}`}>
                  {out || <span className="text-muted">{t("empty")}</span>}
                </p>
              </section>
            );
          })}
        </div>
      }
    />
  );
}
