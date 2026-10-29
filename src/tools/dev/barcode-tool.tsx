import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { EngineProps } from "../../engines";
import { BARCODES, validateBarcode, type BarcodeKind, type Validation } from "../../lib/dev/barcode";
import { loadWriter, writeSymbol } from "../../lib/dev/zxing-writer";
import { downloadBlob } from "../../lib/download";
import { useT } from "../../lib/i18n";
import { useObjectUrl } from "../../lib/use-object-url";
import { Button, ColorField, Slider, Switch, TextField } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { ListCard, Note, Tabs, ValueRow } from "../utility/shared";
import { contrast, isInverted, svgToPng } from "./shared";
import { barS, devCommon } from "./strings";

type BarKey = keyof typeof barS.en;

const HINT: Partial<Record<BarcodeKind, BarKey>> = {
  EAN13: "hintEan",
  EAN8: "hintEan8",
  UPCA: "hintUpca",
  UPCE: "hintUpce",
  ITF: "hintItf",
  Code39: "hintCode39",
  Codabar: "hintCodabar",
  Code128: "hintCode128",
  Code93: "hintCode93",
};

function message(v: Validation, kind: BarcodeKind, t: (k: BarKey, vars?: Record<string, string | number>) => string): { tone: "err" | "muted"; text: string } | null {
  if (v.ok) {
    if (!v.note) return null;
    const key = ({ checkAdded: "noteCheck", upper: "noteUpper", padded: "notePadded", startStop: "noteStartStop" } as const)[v.note];
    return { tone: "muted", text: t(key, { digit: v.digit ?? "" }) };
  }
  const key = (
    {
      empty: "errEmpty",
      digits: "errDigits",
      length: "errLength",
      check: "errCheck",
      charset: kind === "Code39" ? "errCharsetCode39" : "errCharset",
      upceSystem: "errUpceSystem",
      codabarChars: "errCodabar",
    } as const
  )[v.error];
  return { tone: "err", text: t(key, { lengths: v.lengths ?? "", expected: v.expected ?? "" }) };
}

export default function BarcodeTool({ meta }: EngineProps) {
  const t = useT(barS);
  const tc = useT(devCommon);
  const [kind, setKind] = useState<BarcodeKind>((meta.preset?.format as BarcodeKind | undefined) ?? "Code128");
  const [values, setValues] = useState<Partial<Record<BarcodeKind, string>>>({});
  const [hrt, setHrt] = useState(true);
  const [scale, setScale] = useState(3);
  const [quiet, setQuiet] = useState(true);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [out, setOut] = useState<{ svg: string; error: string | null } | null>(null);

  const spec = BARCODES.find((b) => b.id === kind)!;
  const value = values[kind] ?? spec.sample;
  const check = useMemo(() => validateBarcode(kind, value), [kind, value]);
  const msg = message(check, kind, t);
  const encoded = check.ok ? check.value : null;

  useEffect(() => void loadWriter().catch(() => undefined), []);

  useEffect(() => {
    if (!encoded) return setOut(null);
    let live = true;
    writeSymbol(encoded, { format: kind, scale, addHRT: hrt && spec.linear, addQuietZones: quiet }).then(
      (r) => live && setOut({ svg: r.svg, error: r.error || null }),
      (e) => live && setOut({ svg: "", error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [encoded, kind, scale, hrt, quiet, spec.linear]);

  // zint draws black on white; swap in the chosen colours.
  const svg = out?.svg ? out.svg.replace(/fill="#000000"/gi, `fill="${fg}"`).replace(/fill="#FFFFFF"/gi, `fill="${bg}"`) : null;
  const svgBlob = useMemo(() => (svg ? new Blob([svg], { type: "image/svg+xml" }) : null), [svg]);
  const preview = useObjectUrl(svgBlob);
  const file = `${kind.toLowerCase()}-${(encoded ?? "barcode").replace(/[^\w-]+/g, "_").slice(0, 40)}`;
  const hintKey = HINT[kind];

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<BarcodeKind> label={t("format")} value={kind} onChange={setKind} className="grid-cols-3 sm:grid-cols-4 xl:grid-cols-6" options={BARCODES.map((b) => ({ value: b.id, label: b.label }))} />
          <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
            <TextField
              label={t("value")}
              value={value}
              onChange={(e) => setValues({ ...values, [kind]: e.target.value })}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={msg?.tone === "err"}
              className="font-mono"
              data-testid="barcode-input"
            />
            {msg ? (
              <span data-testid="barcode-message">
                <Note tone={msg.tone}>{msg.text}</Note>
              </span>
            ) : null}
            <p className="text-xs leading-relaxed text-muted">{t(hintKey ?? "hint2d")}</p>
          </div>
          <ListCard
            title={spec.label}
            testId="barcode-preview"
            actions={
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={!svg} onClick={async () => svg && downloadBlob(await svgToPng(svg), `${file}.png`)} data-testid="barcode-png">
                  <Download className="size-3.5" />
                  {tc("downloadPng")}
                </Button>
                <Button size="sm" disabled={!svgBlob} onClick={() => svgBlob && downloadBlob(svgBlob, `${file}.svg`)} data-testid="barcode-svg">
                  <Download className="size-3.5" />
                  {tc("downloadSvg")}
                </Button>
              </div>
            }
          >
            <div className="flex min-h-40 min-w-0 items-center justify-center overflow-x-auto p-4">
              {preview ? (
                <img src={preview} alt={encoded ?? ""} className="checker h-auto max-w-full rounded border border-line" data-testid="barcode-image" />
              ) : out?.error ? (
                <Note tone="err">{out.error}</Note>
              ) : encoded ? (
                <Loader2 className="size-4 animate-spin text-muted" aria-label={tc("loading")} />
              ) : null}
            </div>
            {encoded && preview ? (
              <div className="border-t border-line">
                <ValueRow label={t("value")} value={encoded} testId="barcode-encoded" />
              </div>
            ) : null}
          </ListCard>
        </div>
      }
      settings={
        <>
          {spec.linear ? <Switch checked={hrt} onChange={setHrt} label={t("hrt")} hint={t("hrtHint")} /> : null}
          <Slider label={t("scale")} value={scale} onChange={setScale} min={1} max={12} suffix=" px" />
          <Switch checked={quiet} onChange={setQuiet} label={t("quiet")} hint={t("quietHint")} />
          <div className="grid grid-cols-2 gap-3">
            <ColorField label={tc("foreground")} value={fg} onChange={setFg} />
            <ColorField label={tc("background")} value={bg} onChange={setBg} />
          </div>
          {contrast(fg, bg) < 3 ? <Note tone="err">{tc("lowContrast")}</Note> : isInverted(fg, bg) ? <Note>{tc("inverted")}</Note> : null}
        </>
      }
    />
  );
}
