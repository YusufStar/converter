import { useState } from "react";
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowUp, ArrowUpLeft, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { addPageNumbers, formatNumber, type Spot } from "../../lib/pdf/stamp";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { ColorField, Field, NumberField, Segmented, Slider, Switch, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { MiniPage, PDF_ACCEPT, pdfBlob, zipNameFor } from "./common";
import { s } from "./strings";

type Style = "n" | "of" | "slash";

const SPOTS: [Spot, LucideIcon][] = [
  ["tl", ArrowUpLeft],
  ["tc", ArrowUp],
  ["tr", ArrowUpRight],
  ["bl", ArrowDownLeft],
  ["bc", ArrowDown],
  ["br", ArrowDownRight],
];

export default function NumbersTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [spot, setSpot] = useState<Spot>("bc");
  const [style, setStyle] = useState<Style>("n");
  const [start, setStart] = useState<number | null>(1);
  const [size, setSize] = useState(11);
  const [margin, setMargin] = useState(28);
  const [color, setColor] = useState("#333333");
  const [skipFirst, setSkipFirst] = useState(false);
  const n = queue.items.length;
  const template = style === "n" ? "{n}" : style === "slash" ? "{n} / {total}" : t("tplPageOf");

  const run = () =>
    queue.runEach(async (file) => {
      const bytes = await addPageNumbers(await file.arrayBuffer(), { spot, template, start: start ?? 1, size, margin, color, skipFirst });
      return { name: `${splitName(file.name).base}-numbered.pdf`, blob: pdfBlob(bytes) };
    }, 3);

  // Preview sheet is 112px wide for a 595pt A4 page.
  const k = 112 / 595;
  const sample = formatNumber(template, start ?? 1, (start ?? 1) + 11);

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <Field label={t("position")}>
              <Segmented<Spot>
                label={t("position")}
                value={spot}
                onChange={setSpot}
                columns={3}
                options={SPOTS.map(([value, Icon]) => ({
                  value,
                  title: t(value),
                  label: (
                    <span className="inline-flex items-center justify-center">
                      <Icon className="size-4" aria-hidden />
                      <span className="sr-only">{t(value)}</span>
                    </span>
                  ),
                }))}
              />
            </Field>
            <MiniPage label={t("preview")}>
              <span
                className={cx("absolute leading-none whitespace-nowrap", spot[1] === "c" && "left-1/2 -translate-x-1/2")}
                style={{
                  color,
                  fontSize: Math.max(5, size * k * 1.4),
                  [spot[0] === "t" ? "top" : "bottom"]: margin * k,
                  ...(spot[1] === "l" ? { left: margin * k } : spot[1] === "r" ? { right: margin * k } : {}),
                }}
              >
                {sample}
              </span>
            </MiniPage>
          </div>
          <Field label={t("numFormat")}>
            <Segmented<Style>
              label={t("numFormat")}
              value={style}
              onChange={setStyle}
              columns={3}
              size="sm"
              options={[
                { value: "n", label: "1" },
                { value: "of", label: t("tplPageOf", { n: 1, total: "N" }) },
                { value: "slash", label: "1 / N" },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t("startAt")} value={start} onChange={setStart} min={0} step={1} />
            <ColorField label={t("color")} value={color} onChange={setColor} />
          </div>
          <Slider label={t("fontSize")} value={size} onChange={setSize} min={6} max={36} suffix=" pt" />
          <Slider label={t("margin")} value={margin} onChange={setMargin} min={8} max={96} suffix=" pt" />
          <Switch checked={skipFirst} onChange={setSkipFirst} label={t("skipFirst")} hint={t("skipFirstHint")} />
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("numbersRunN", { n }) : t("numbersRun")} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
