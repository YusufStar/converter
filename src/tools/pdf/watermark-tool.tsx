import { useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { addWatermark } from "../../lib/pdf/stamp";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { ColorField, Field, Segmented, Slider, TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { MiniPage, PDF_ACCEPT, PageScope, pdfBlob, scopeInvalid, scopeRanges, zipNameFor, type Scope } from "./common";
import { s } from "./strings";

type Mode = "center" | "tile";

export default function WatermarkTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [text, setText] = useState(() => t("wmDefault"));
  const [mode, setMode] = useState<Mode>("center");
  const [size, setSize] = useState(56);
  const [opacity, setOpacity] = useState(25);
  const [angle, setAngle] = useState(45);
  const [color, setColor] = useState("#e5484d");
  const [scope, setScope] = useState<Scope>({ all: true, ranges: "" });
  const n = queue.items.length;

  const run = () =>
    queue.runEach(async (file) => {
      const bytes = await addWatermark(await file.arrayBuffer(), {
        text,
        size,
        opacity: opacity / 100,
        angle,
        color,
        mode,
        pages: scopeRanges(scope),
      });
      return { name: `${splitName(file.name).base}-watermarked.pdf`, blob: pdfBlob(bytes) };
    }, 3);

  // Preview sheet is 112px wide for a 595pt A4 page; CSS rotates clockwise, PDF counter-clockwise.
  const k = 112 / 595;
  const word = (
    <span className="font-sans leading-none font-semibold whitespace-nowrap" style={{ fontSize: Math.max(4, size * k), color }}>
      {text || " "}
    </span>
  );

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          <TextField label={t("wmText")} value={text} onChange={(e) => setText(e.target.value)} maxLength={120} data-testid="wm-text" />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div className="flex min-w-0 flex-col gap-4">
              <Field label={t("layout")}>
                <Segmented<Mode>
                  label={t("layout")}
                  value={mode}
                  onChange={setMode}
                  columns={2}
                  size="sm"
                  options={[
                    { value: "center", label: t("center") },
                    { value: "tile", label: t("tile") },
                  ]}
                />
              </Field>
              <ColorField label={t("color")} value={color} onChange={setColor} />
            </div>
            <MiniPage label={t("preview")}>
              <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: opacity / 100 }}>
                {mode === "center" ? (
                  <div style={{ transform: `rotate(${-angle}deg)` }}>{word}</div>
                ) : (
                  <div className="grid shrink-0 grid-cols-3 place-items-center gap-x-3 gap-y-4" style={{ transform: `rotate(${-angle}deg)` }}>
                    {Array.from({ length: 21 }, (_, i) => (
                      <span key={i}>{word}</span>
                    ))}
                  </div>
                )}
              </div>
            </MiniPage>
          </div>
          <Slider label={t("fontSize")} value={size} onChange={setSize} min={12} max={160} suffix=" pt" />
          <Slider label={t("opacity")} value={opacity} onChange={setOpacity} min={5} max={100} suffix="%" />
          <Slider label={t("angle")} value={angle} onChange={setAngle} min={-90} max={90} step={5} suffix="°" />
          <PageScope value={scope} onChange={setScope} />
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("wmRunN", { n }) : t("wmRun")} disabled={!text.trim() || scopeInvalid(scope)} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
