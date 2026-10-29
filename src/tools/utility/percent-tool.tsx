import { useState } from "react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { addPercent, percentChange, percentOf, whatPercent } from "../../lib/utility/percent";
import { formatNumber, plainNumber } from "../../lib/utility/units";
import { NumberField, Segmented } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { CopyButton } from "./shared";
import { percentStrings } from "./strings";

type Key = keyof typeof percentStrings.en;
type Decimals = "auto" | 0 | 1 | 2 | 4;

/** Display + copy formatters for the chosen rounding. */
function formatters(lang: string, d: Decimals) {
  if (d === "auto") return { show: (n: number) => formatNumber(n, lang, 10), copy: (n: number) => plainNumber(n) };
  const nf = new Intl.NumberFormat(lang, { minimumFractionDigits: d, maximumFractionDigits: d });
  return { show: (n: number) => nf.format(n), copy: (n: number) => n.toFixed(d) };
}

function Calc({
  title,
  labels,
  initial,
  compute,
  testId,
  fmt,
}: {
  fmt: ReturnType<typeof formatters>;
  title: Key;
  labels: [Key, Key];
  initial: [number, number];
  compute: (x: number, y: number) => { value: number; text?: string; suffix?: string }[];
  testId: string;
}) {
  const t = useT(percentStrings);
  const [x, setX] = useState<number | null>(initial[0]);
  const [y, setY] = useState<number | null>(initial[1]);
  const results = x === null || y === null ? null : compute(x, y);
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface" data-testid={testId}>
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{t(title)}</h2>
      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t(labels[0])} value={x} onChange={setX} />
          <NumberField label={t(labels[1])} value={y} onChange={setY} />
        </div>
        <div className="flex flex-col gap-1.5">
          {!results ? (
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">{t("fillIn")}</p>
          ) : (
            results.map((r, i) => (
              <div key={i} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-surface-2 py-1.5 pr-1.5 pl-3">
                <span className="min-w-0 font-mono text-lg font-semibold wrap-anywhere tabular-nums" data-testid={`${testId}-out`}>
                  {Number.isNaN(r.value) ? <span className="text-sm font-normal text-muted">{t("divZero")}</span> : (r.text ?? fmt.show(r.value)) + (r.suffix ?? "")}
                </span>
                <CopyButton value={Number.isNaN(r.value) ? "" : fmt.copy(r.value)} />
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export default function PercentTool({ meta }: EngineProps) {
  const t = useT(percentStrings);
  const lang = useLang();
  const [decimals, setDecimals] = useState<Decimals>("auto");
  const fmt = formatters(lang, decimals);
  const pct = (n: number) => (lang === "tr" ? `%${fmt.show(n)}` : `${fmt.show(n)}%`);
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Calc title="ofTitle" labels={["percentX", "numberY"]} initial={[15, 200]} compute={(x, y) => [{ value: percentOf(x, y) }]} testId="pct-of" fmt={fmt} />
          <Calc
            title="whatTitle"
            labels={["partX", "totalY"]}
            initial={[30, 200]}
            compute={(x, y) => {
              const v = whatPercent(x, y);
              return [{ value: v, text: Number.isNaN(v) ? undefined : pct(v) }];
            }}
            testId="pct-what" fmt={fmt}
          />
          <Calc
            title="changeTitle"
            labels={["oldX", "newY"]}
            initial={[80, 100]}
            compute={(x, y) => {
              const v = percentChange(x, y);
              const n = fmt.show(Math.abs(v));
              return [{ value: v, text: Number.isNaN(v) ? undefined : v === 0 ? t("noChange") : t(v > 0 ? "increase" : "decrease", { n }) }];
            }}
            testId="pct-change" fmt={fmt}
          />
          <Calc
            title="addTitle"
            labels={["percentX", "numberY"]}
            initial={[20, 150]}
            compute={(x, y) => [
              { value: addPercent(y, x), suffix: `  (${t("plus")})` },
              { value: addPercent(y, -x), suffix: `  (${t("minus")})` },
            ]}
            testId="pct-add" fmt={fmt}
          />
        </div>
      }
      settings={
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t("decimals")}</span>
          <Segmented<Decimals>
            label={t("decimals")}
            value={decimals}
            onChange={setDecimals}
            size="sm"
            options={[
              { value: "auto", label: t("auto") },
              { value: 0, label: "0" },
              { value: 1, label: "1" },
              { value: 2, label: "2" },
              { value: 4, label: "4" },
            ]}
          />
          <p className="text-xs leading-relaxed text-muted">{t("decimalsHint")}</p>
        </div>
      }
    />
  );
}
