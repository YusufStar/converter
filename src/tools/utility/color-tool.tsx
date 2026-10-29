import { useRef, useState } from "react";
import { Check, Dices, Palette, Pipette, X } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { BLACK, WHITE, contrast, formatAll, nearestNamed, parseColor, toHex, wcag, type FormatId, type RGBA, type Syntax } from "../../lib/utility/color";
import { Button, Segmented, Slider, Switch, TextField, cx } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { ListCard, Note, ValueRow } from "./shared";
import { colorStrings } from "./strings";

const DEFAULT = "#ff6b2c";
const ORDER: FormatId[] = ["hex", "rgb", "hsl", "hsv", "hwb", "cmyk", "lab", "lch", "oklab", "oklch"];

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}

const css = (c: RGBA) => `rgb(${c.r} ${c.g} ${c.b} / ${c.a})`;

function ContrastCard({ color, bg, title }: { color: RGBA; bg: RGBA; title: string }) {
  const t = useT(colorStrings);
  const lang = useLang();
  const ratio = contrast(color, bg);
  const levels = wcag(ratio);
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium">{title}</h3>
        <span className="font-mono text-lg font-semibold tabular-nums" data-testid={`contrast-${bg === WHITE ? "white" : "black"}`}>
          {new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(ratio)}:1
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-line px-4 py-3" style={{ background: css(bg), color: css(color) }}>
        <span className="text-2xl font-semibold">Aa</span>
        <span className="truncate text-sm">{t("sampleText")}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {(["aa", "aaLarge", "aaa", "aaaLarge"] as const).map((key) => {
          const ok = levels[key];
          return (
            <span
              key={key}
              className={cx("flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium", ok ? "bg-ok/10 text-ok" : "bg-err/10 text-err")}
            >
              <span className="truncate">{t(key)}</span>
              <span className="flex shrink-0 items-center gap-1">
                {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                {ok ? t("pass") : t("fail")}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function ColorTool({ meta }: EngineProps) {
  const t = useT(colorStrings);
  const [text, setText] = useState(DEFAULT);
  const [base, setBase] = useState<RGBA>(() => parseColor(DEFAULT)!);
  const [clipped, setClipped] = useState(false);
  const [alpha, setAlpha] = useState<number | null>(null);
  const [upper, setUpper] = useState(false);
  const [syntax, setSyntax] = useState<Syntax>("legacy");
  const picker = useRef<HTMLInputElement>(null);

  const input = (value: string) => {
    setText(value);
    const c = parseColor(value);
    if (c) {
      setBase({ r: c.r, g: c.g, b: c.b, a: c.a });
      setClipped(c.clipped);
      setAlpha(null);
    }
  };
  const invalid = text.trim() !== "" && !parseColor(text);
  const color: RGBA = { ...base, a: alpha ?? base.a };
  const formats = formatAll(color, syntax, upper);
  const named = nearestNamed(color);
  const solid = { ...color, a: 1 };
  const best = contrast(WHITE, solid) >= contrast(BLACK, solid) ? WHITE : BLACK;
  const EyeDropper = typeof window !== "undefined" ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;

  const openPicker = () => {
    try {
      picker.current?.showPicker();
    } catch {
      picker.current?.click();
    }
  };
  const fromScreen = async () => {
    if (!EyeDropper) return;
    try {
      input((await new EyeDropper().open()).sRGBHex);
    } catch {
      // cancelled
    }
  };
  const random = () => {
    const c = parseColor(`hsl(${Math.round(Math.random() * 360)} ${55 + Math.round(Math.random() * 40)}% ${40 + Math.round(Math.random() * 25)}%)`)!;
    input(toHex(c));
  };

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="grid min-w-0 gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <div className="checker relative h-36 min-w-0 overflow-hidden rounded-xl border border-line sm:h-auto sm:min-h-48">
            <div className="absolute inset-0 transition-colors duration-200" style={{ background: css(color) }} data-testid="color-swatch" />
            <span className="pointer-events-none absolute bottom-3 left-3 font-mono text-sm font-semibold" style={{ color: css(best) }}>
              {formats.hex}
            </span>
            <input
              ref={picker}
              type="color"
              value={toHex(solid)}
              onChange={(e) => input(e.target.value)}
              aria-label={t("pick")}
              title={t("pick")}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              data-testid="color-picker"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <TextField
              label={t("input")}
              value={text}
              onChange={(e) => input(e.target.value)}
              placeholder={t("placeholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-12 font-mono text-lg"
              aria-invalid={invalid}
              data-testid="color-input"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={openPicker}>
                <Palette className="size-3.5" />
                {t("pick")}
              </Button>
              {EyeDropper ? (
                <Button size="sm" onClick={fromScreen}>
                  <Pipette className="size-3.5" />
                  {t("eyedropper")}
                </Button>
              ) : null}
              <Button size="sm" onClick={random} data-testid="color-random">
                <Dices className="size-3.5" />
                {t("random")}
              </Button>
            </div>
            {invalid ? <Note tone="err">{t("invalid")}</Note> : <Note>{t("accepts")}</Note>}
            {clipped && !invalid ? <Note>{t("clipped")}</Note> : null}
          </div>
        </section>
      }
      settings={
        <>
          <Slider label={t("alpha")} value={Math.round(color.a * 100)} onChange={(v) => setAlpha(v / 100)} min={0} max={100} suffix="%" />
          <Switch checked={upper} onChange={setUpper} label={t("upperHex")} />
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">{t("syntax")}</span>
            <Segmented<Syntax>
              label={t("syntax")}
              value={syntax}
              onChange={setSyntax}
              size="sm"
              options={[
                { value: "legacy", label: t("legacy") },
                { value: "modern", label: t("modern") },
              ]}
            />
            <p className="text-xs leading-relaxed text-muted">{t("syntaxHint")}</p>
          </div>
          <Note>{t("cmykHint")}</Note>
        </>
      }
      results={
        <div className="flex min-w-0 flex-col gap-5">
          <ListCard title={t("formats")} testId="color-formats">
            <div className="divide-y divide-line">
              {ORDER.map((id) => (
                <ValueRow key={id} label={id.toUpperCase()} value={formats[id]} testId={`fmt-${id}`} />
              ))}
              <ValueRow label={t("name")} value={named.exact ? named.name : t("nearest", { name: named.name })} copy={named.name} testId="fmt-name" />
            </div>
          </ListCard>
          <ListCard title={t("contrast")}>
            <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <ContrastCard color={color} bg={WHITE} title={t("onWhite")} />
              <ContrastCard color={color} bg={BLACK} title={t("onBlack")} />
            </div>
            <div className="flex flex-col gap-3 border-t border-line p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 shrink-0 items-center rounded-lg border border-line px-3 text-sm font-semibold" style={{ background: css(solid), color: css(best) }}>
                  Aa
                </span>
                <span className="min-w-0 text-sm">{t("bestText", { color: best === WHITE ? t("white") : t("black") })}</span>
              </div>
              <Note>{t("contrastHint")}</Note>
            </div>
          </ListCard>
        </div>
      }
    />
  );
}
