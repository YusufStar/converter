import { useState } from "react";
import {
  ArrowRightLeft,
  AudioWaveform,
  Beaker,
  CircleGauge,
  Clock,
  CookingPot,
  DraftingCompass,
  Fuel,
  Gauge,
  HardDrive,
  LandPlot,
  Plug,
  Ruler,
  Thermometer,
  Weight,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { CATEGORIES, categoryById, convertUnit, formatNumber, parseNumber, plainNumber, type CategoryId, type Unit } from "../../lib/utility/units";
import { IconButton, Slider, Switch, TextField, cx } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { CopyButton, ListCard, Note, Select } from "./shared";
import { unitNames, unitStrings, unitSymbols } from "./strings";

const CAT_ICON: Record<CategoryId, LucideIcon> = {
  length: Ruler,
  mass: Weight,
  temperature: Thermometer,
  area: LandPlot,
  volume: Beaker,
  speed: Gauge,
  time: Clock,
  data: HardDrive,
  rate: Wifi,
  pressure: CircleGauge,
  energy: Zap,
  power: Plug,
  angle: DraftingCompass,
  frequency: AudioWaveform,
  fuel: Fuel,
  cooking: CookingPot,
};

type Side = "from" | "to";

export default function UnitTool({ meta }: EngineProps) {
  const t = useT(unitStrings);
  const tn = useT(unitNames);
  const ts = useT(unitSymbols);
  const lang = useLang();
  const initial = categoryById.get(meta.preset?.category as CategoryId) ?? CATEGORIES[0];
  const [cat, setCat] = useState<CategoryId>(initial.id);
  const [from, setFrom] = useState(initial.pair[0]);
  const [to, setTo] = useState(initial.pair[1]);
  const [src, setSrc] = useState<{ side: Side; text: string }>({ side: "from", text: "1" });
  const [digits, setDigits] = useState(10);
  const [grouping, setGrouping] = useState(true);

  const category = categoryById.get(cat)!;
  const name = (u: Unit) => tn(u.id as keyof typeof unitNames.en);
  const sym = (u: Unit) => (u.id in unitSymbols.en ? ts(u.id as keyof typeof unitSymbols.en) : u.symbol);
  const unit = (id: string) => category.units.find((u) => u.id === id)!;

  const parsed = parseNumber(src.text, lang);
  const valueOf = (side: Side) => (parsed === null ? null : src.side === side ? parsed : side === "to" ? convertUnit(parsed, cat, from, to) : convertUnit(parsed, cat, to, from));
  const fromValue = valueOf("from");
  const toValue = valueOf("to");
  const textOf = (side: Side, v: number | null) => (src.side === side ? src.text : v === null ? "" : plainNumber(v, digits));
  const fromText = textOf("from", fromValue);
  const toText = textOf("to", toValue);
  const invalid = src.text.trim() !== "" && parsed === null;
  const noResult = !invalid && (Number.isNaN(fromValue) || Number.isNaN(toValue));

  // Unit changes keep the quantity typed on the "from" side.
  const pin = () => setSrc({ side: "from", text: fromText });
  const pickCategory = (id: CategoryId) => {
    const c = categoryById.get(id)!;
    setCat(id);
    setFrom(c.pair[0]);
    setTo(c.pair[1]);
    setSrc({ side: "from", text: fromText || "1" });
  };
  const swap = () => {
    setFrom(to);
    setTo(from);
    setSrc({ side: "from", text: toText });
  };
  const fmt = (v: number | null) => (v === null ? "—" : formatNumber(v, lang, digits, grouping));
  const note = `note_${cat}` in unitStrings.en ? t(`note_${cat}` as keyof typeof unitStrings.en) : null;

  const end = (side: Side) => {
    const id = side === "from" ? from : to;
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <TextField
          label={t(side)}
          value={side === "from" ? fromText : toText}
          onChange={(e) => setSrc({ side, text: e.target.value })}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className="h-12 font-mono text-lg tabular-nums"
          data-testid={`unit-${side}`}
          aria-invalid={src.side === side && invalid}
        />
        <Select
          label={t(side === "from" ? "fromUnit" : "toUnit")}
          value={id}
          onChange={(e) => {
            pin();
            (side === "from" ? setFrom : setTo)(e.target.value);
          }}
          data-testid={`unit-${side}-select`}
        >
          {category.units.map((u) => (
            <option key={u.id} value={u.id}>
              {name(u)} ({sym(u)})
            </option>
          ))}
        </Select>
      </div>
    );
  };

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="flex min-w-0 flex-col gap-5 rounded-2xl border border-line bg-surface p-4">
          <div role="radiogroup" aria-label={t("category")} className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {CATEGORIES.map((c) => {
              const Icon = CAT_ICON[c.id];
              const active = c.id === cat;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => pickCategory(c.id)}
                  className={cx(
                    "flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center text-[11px] leading-tight font-medium transition duration-150 ease-out-soft",
                    active ? "border-accent bg-accent-soft text-fg" : "border-transparent bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  <Icon className={cx("size-4 shrink-0", active && "text-accent-text")} />
                  <span className="w-full break-words hyphens-auto">{t(`cat_${c.id}` as keyof typeof unitStrings.en)}</span>
                </button>
              );
            })}
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            {end("from")}
            <div className="flex justify-center">
              <IconButton label={t("swap")} onClick={swap} className="size-10 rounded-full border border-line bg-surface-2 text-fg" data-testid="unit-swap">
                <ArrowRightLeft className="size-4 rotate-90 sm:rotate-0" />
              </IconButton>
            </div>
            {end("to")}
          </div>

          {invalid ? (
            <Note tone="err">{t("invalid")}</Note>
          ) : noResult ? (
            <Note tone="err">{t("noResult")}</Note>
          ) : (
            <div className="flex min-w-0 items-start justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="min-w-0 font-mono text-lg font-semibold wrap-anywhere tabular-nums sm:text-xl" data-testid="unit-summary">
                  {fmt(fromValue)} {sym(unit(from))} = <span className="text-accent-text">{fmt(toValue)}</span> {sym(unit(to))}
                </p>
                <p className="font-mono text-xs wrap-anywhere text-muted">
                  {t("reverse", { a: sym(unit(to)), b: `${fmt(convertUnit(1, cat, to, from))} ${sym(unit(from))}` })}
                </p>
              </div>
              <CopyButton value={toValue === null ? "" : plainNumber(toValue, digits)} label={name(unit(to))} />
            </div>
          )}
          {note ? <Note>{note}</Note> : null}
        </section>
      }
      settings={
        <>
          <div className="flex flex-col gap-1.5">
            <Slider label={t("precision")} value={digits} onChange={setDigits} min={3} max={15} />
            <p className="text-xs leading-relaxed text-muted">{t("precisionHint")}</p>
          </div>
          <Switch checked={grouping} onChange={setGrouping} label={t("grouping")} hint={t("groupingHint")} />
        </>
      }
      results={
        <ListCard title={`${t("allUnits")} · ${t(`cat_${cat}` as keyof typeof unitStrings.en)}`} actions={<span className="text-xs text-muted">{t("allUnitsHint")}</span>} testId="unit-table">
          <ul className="divide-y divide-line">
            {category.units.map((u) => {
              const v = fromValue === null ? NaN : convertUnit(fromValue, cat, from, u.id);
              const active = u.id === to;
              return (
                <li key={u.id} className={cx("flex min-w-0 items-center gap-1 pr-2 pl-1", active && "bg-accent-soft/60")} data-testid={`unit-row-${u.id}`}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      pin();
                      setTo(u.id);
                    }}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-surface-2/70 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0 text-sm">
                      {name(u)} <span className="font-mono text-xs text-muted">{sym(u)}</span>
                    </span>
                    <span className={cx("min-w-0 font-mono text-sm wrap-anywhere tabular-nums sm:text-right", active && "font-semibold text-accent-text")}>{fmt(v)}</span>
                  </button>
                  <CopyButton value={plainNumber(v, digits)} label={name(u)} />
                </li>
              );
            })}
          </ul>
        </ListCard>
      }
    />
  );
}
