import { useState } from "react";
import { Check, Copy, Info } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useT } from "../../lib/i18n";
import { renderToCanvas } from "../../lib/image/convert";
import { canvasToBlob } from "../../lib/image/encode";
import { FAVICON_HTML, FAVICON_ICO_SIZES, FAVICON_PNGS, webManifest } from "../../lib/image/favicon";
import { IMAGE_ACCEPT, IMAGE_FORMATS_LABEL, inputKind } from "../../lib/image/formats";
import { encodeIco } from "../../lib/image/ico";
import { DEFAULT_RESIZE } from "../../lib/image/resize";
import type { OutputInit } from "../../lib/use-queue";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, ColorField, Field, Segmented, Slider, TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { ui } from "../../ui/strings";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

interface IconStyle {
  /** 0..0.3 of the size */
  padding: number;
  background: string | null;
  /** 0..0.5 of the size */
  radius: number;
}

/** Draws `src` contained in a size×size square with optional rounded background and padding. */
function iconCanvas(src: HTMLCanvasElement, size: number, st: IconStyle): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  if (st.background) {
    g.fillStyle = st.background;
    g.beginPath();
    g.roundRect(0, 0, size, size, st.radius * size);
    g.fill();
  }
  const inner = size * (1 - 2 * st.padding);
  const f = Math.min(inner / src.width, inner / src.height);
  const w = src.width * f;
  const h = src.height * f;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

const png = async (c: HTMLCanvasElement) => new Uint8Array(await (await canvasToBlob(c, "image/png")).arrayBuffer());

function CopyHtml() {
  const t = useT(ui);
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(FAVICON_HTML);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? t("copied") : "HTML"}
    </Button>
  );
}

export default function FaviconTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue({ multiple: false });
  const [style, setStyle] = useState<IconStyle>({ padding: 0, background: null, radius: 0.2 });
  const [name, setName] = useState("");
  const set = (p: Partial<IconStyle>) => setStyle((x) => ({ ...x, ...p }));

  const run = () =>
    queue.runEach(async (file) => {
      // Render big once (SVG as vector at 512), then scale down per size.
      const vector = inputKind(file) === "svg";
      const resize = vector ? { ...DEFAULT_RESIZE, mode: "dimensions" as const, width: 512, height: 512, keepAspect: true } : DEFAULT_RESIZE;
      const src = await renderToCanvas(file, { resize, rotate: 0, flipH: false, flipV: false, background: null });
      const out: OutputInit[] = [];
      const ico = await Promise.all(FAVICON_ICO_SIZES.map(async (size) => ({ size, png: await png(iconCanvas(src, size, style)) })));
      out.push({ name: "favicon.ico", blob: new Blob([encodeIco(ico) as BlobPart], { type: "image/x-icon" }), note: "16 · 32 · 48" });
      for (const p of FAVICON_PNGS) {
        out.push({ name: p.name, blob: new Blob([(await png(iconCanvas(src, p.size, style))) as BlobPart], { type: "image/png" }), width: p.size, height: p.size });
      }
      out.push({ name: "site.webmanifest", blob: new Blob([webManifest(name, style.background ?? "#ffffff")], { type: "application/manifest+json" }) });
      // The source size isn't meaningful for a set of icons.
      return out.map((o) => ({ ...o, sourceSize: undefined }));
    }, 1);

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={IMAGE_ACCEPT} formats={IMAGE_FORMATS_LABEL} multiple={false} />}
      settings={
        <>
          <Slider label={t("favPadding")} value={Math.round(style.padding * 100)} onChange={(v) => set({ padding: v / 100 })} min={0} max={30} suffix="%" />
          <Field label={t("favBg")}>
            <Segmented
              label={t("favBg")}
              value={style.background === null ? "none" : "fill"}
              onChange={(v) => set({ background: v === "none" ? null : "#ffffff" })}
              options={[
                { value: "none", label: t("favTransparent") },
                { value: "fill", label: t("favFill") },
              ]}
              size="sm"
            />
            {style.background !== null ? (
              <>
                <ColorField label={t("color")} value={style.background} onChange={(background) => set({ background })} />
                <Slider label={t("favRadius")} value={Math.round(style.radius * 100)} onChange={(v) => set({ radius: v / 100 })} min={0} max={50} suffix="%" />
              </>
            ) : null}
          </Field>
          <TextField label={t("favName")} value={name} onChange={(e) => setName(e.target.value)} placeholder="My site" />
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("favIncludes")} {t("favSource")}
            </span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={t("favMake")} />}
      results={
        <Results outputs={queue.outputs} zipName="favicons.zip" extra={queue.outputs.length ? <CopyHtml /> : null}>
          {queue.outputs.length ? (
            <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed text-muted">{FAVICON_HTML}</pre>
          ) : null}
        </Results>
      }
    />
  );
}
