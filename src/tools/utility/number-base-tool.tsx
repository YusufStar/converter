import { useState } from "react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { bitLength, groupDigits, groupSize, parseInteger, toBase, twosComplement } from "../../lib/utility/number-base";
import { NumberField, Slider, Switch, TextField } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { ListCard, Note, Tabs, ValueRow } from "./shared";
import { baseStrings } from "./strings";

type Choice = 2 | 8 | 10 | 16 | 0;
const NAMED: Record<number, "bin" | "oct" | "dec" | "hex"> = { 2: "bin", 8: "oct", 10: "dec", 16: "hex" };
const PREFIX: Record<number, string> = { 2: "0b", 8: "0o", 16: "0x" };

/** "0–7" for base 8, "0–9, a–f" for base 16. */
function allowed(base: number): string {
  if (base <= 10) return `0–${base - 1}`;
  return `0–9, a–${"abcdefghijklmnopqrstuvwxyz"[base - 11]}`;
}

export default function NumberBaseTool({ meta }: EngineProps) {
  const t = useT(baseStrings);
  const lang = useLang();
  const [text, setText] = useState("255");
  const [choice, setChoice] = useState<Choice>(10);
  const [custom, setCustom] = useState(3);
  const [extra, setExtra] = useState(36);
  const [group, setGroup] = useState(true);
  const [upper, setUpper] = useState(false);

  const inBase = choice || Math.min(36, Math.max(2, custom));
  const parsed = parseInteger(text, inBase);
  const value = parsed.ok ? parsed.value : null;
  const baseName = (b: number) => (NAMED[b] ? t(NAMED[b]) : t("baseN", { n: b }));
  const show = (s: string, base: number) => (group ? groupDigits(s, groupSize(base)) : s);

  const outputs = [2, 8, 10, 16, ...([2, 8, 10, 16].includes(extra) ? [] : [extra])];
  const negative = value !== null && value < 0n;
  const bits = value === null ? 0 : bitLength(value);

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[13px] font-medium">{t("fromBase")}</span>
            <Tabs<Choice>
              label={t("fromBase")}
              value={choice}
              onChange={setChoice}
              className="grid-cols-3 sm:grid-cols-5"
              options={[
                { value: 2, label: t("bin") },
                { value: 8, label: t("oct") },
                { value: 10, label: t("dec") },
                { value: 16, label: t("hex") },
                { value: 0, label: t("other") },
              ]}
            />
          </div>
          {choice === 0 ? (
            <div className="max-w-40">
              <NumberField label={t("base")} value={custom} onChange={(v) => setCustom(v ?? 2)} min={2} max={36} />
            </div>
          ) : null}
          <TextField
            label={`${t("input")} · ${baseName(inBase)}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("placeholder")}
            autoComplete="off"
            spellCheck={false}
            className="h-12 font-mono text-lg"
            aria-invalid={!parsed.ok && text.trim() !== ""}
            data-testid="base-input"
          />
          {!parsed.ok ? (
            <Note tone="err">
              {parsed.error === "empty" ? t("errEmpty") : t("errDigit", { char: parsed.char, base: parsed.base, allowed: allowed(parsed.base) })}
            </Note>
          ) : parsed.base !== inBase ? (
            <Note>{t("prefixRead", { base: baseName(parsed.base).toLocaleLowerCase(lang), prefix: PREFIX[parsed.base] })}</Note>
          ) : (
            <Note>{t("wholeOnly")}</Note>
          )}
        </section>
      }
      settings={
        <>
          <Switch checked={group} onChange={setGroup} label={t("group")} hint={t("groupHint")} />
          <Switch checked={upper} onChange={setUpper} label={t("upper")} />
          <Slider label={t("otherOut")} value={extra} onChange={setExtra} min={2} max={36} />
        </>
      }
      results={
        value === null ? null : (
          <div className="flex min-w-0 flex-col gap-5">
            <ListCard
              title={t("results")}
              actions={
                <span className="text-xs text-muted tabular-nums">
                  {t("info", { bits, bytes: Math.ceil(bits / 8), digits: toBase(value < 0n ? -value : value, 10).length })}
                </span>
              }
              testId="base-results"
            >
              <div className="divide-y divide-line">
                {outputs.map((b) => {
                  const raw = toBase(value, b, upper);
                  return <ValueRow key={b} label={baseName(b)} value={show(raw, b)} copy={raw} testId={`base-${b}`} />;
                })}
              </div>
            </ListCard>
            {negative ? (
              <ListCard title={t("twos")} actions={<span className="text-xs text-muted">{t("twosHint")}</span>} testId="base-twos">
                <div className="divide-y divide-line">
                  {[8, 16, 32, 64].map((w) => {
                    const tc = twosComplement(value, w);
                    if (tc === null) return <ValueRow key={w} label={t("bits", { n: w })} value={t("doesntFit")} copy="" mono={false} />;
                    const bin = toBase(tc, 2).padStart(w, "0");
                    const hex = toBase(tc, 16, upper).padStart(w / 4, "0");
                    return <ValueRow key={w} label={t("bits", { n: w })} value={show(bin, 2)} copy={bin} sub={`0x${show(hex, 16)}`} testId={`twos-${w}`} />;
                  })}
                </div>
              </ListCard>
            ) : null}
          </div>
        )
      }
    />
  );
}
