import { useEffect, useRef, useState } from "react";
import { Code2, Loader2 } from "lucide-react";
import type { EngineProps } from "../../engines";
import type { Inspected } from "../../lib/font/convert";
import { convertFontFile, FONT_WORKERS, inspectFontFile, warmUpFonts } from "../../lib/font/fonts";
import { charsetCodepoints, fontFaceCss, type Charset, type FaceSource, type FontInfo, type FontTarget } from "../../lib/font/sfnt";
import { formatBytes, uid, uniqueNames, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, Slider, TextField } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { CopyButton } from "../utility/shared";
import { s } from "./strings";

const ACCEPT = ".ttf,.otf,.woff,.woff2,.eot,.svg";
const TARGETS: FontTarget[] = ["woff2", "woff", "ttf", "eot", "svg"];
const MIME: Record<FontTarget, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", eot: "application/vnd.ms-fontobject", svg: "" };
const BROWSER_FONTS = new Set<FontTarget>(["woff2", "woff", "ttf"]);

type Subset = "all" | Charset;
type Inspection = { status: "loading" } | { status: "ready"; value: Inspected } | { status: "error"; message: string };

export default function FontTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [target, setTarget] = useState<FontTarget>((meta.preset as { format?: FontTarget } | undefined)?.format ?? "woff2");
  const [subset, setSubset] = useState<Subset>("all");
  const [custom, setCustom] = useState("");
  const [sample, setSample] = useState<string | null>(null);
  const [size, setSize] = useState(40);
  const [inspected, setInspected] = useState<Record<string, Inspection>>({});
  const started = useRef(new Set<string>());
  // Output blob → what @font-face needs to know about it.
  const faces = useRef(new WeakMap<Blob, FaceSource>());

  useEffect(warmUpFonts, []);

  // Read family / style / glyph count of each new font right away.
  useEffect(() => {
    for (const it of queue.items) {
      if (started.current.has(it.id)) continue;
      started.current.add(it.id);
      setInspected((m) => ({ ...m, [it.id]: { status: "loading" } }));
      inspectFontFile(it.file).then(
        (value) => setInspected((m) => ({ ...m, [it.id]: { status: "ready", value } })),
        (e: Error) => setInspected((m) => ({ ...m, [it.id]: { status: "error", message: e.message } })),
      );
    }
  });

  const label = target.toUpperCase();
  const keep = subset === "all" ? undefined : charsetCodepoints(subset, custom);

  const run = () =>
    queue.runEach(async (file, ctx) => {
      const { data, before, after } = await convertFontFile(file, { target, subset: keep }, ctx.signal);
      const blob = new Blob([data as BlobPart], { type: MIME[target] });
      const name = withExt(file.name, target);
      faces.current.set(blob, { file: name, target, info: after, range: keep });
      const glyphs = after.glyphs === before.glyphs ? t("glyphs", { n: after.glyphs }) : t("glyphsWas", { n: after.glyphs, was: before.glyphs });
      return { name, blob, note: [after.family, after.style, glyphs].filter(Boolean).join(" · ") };
    }, FONT_WORKERS);

  // Same de-duplicated names the "Download all" zip uses.
  const names = uniqueNames(queue.outputs.map((o) => o.name));
  const css = fontFaceCss(queue.outputs.flatMap((o, i) => {
    const face = faces.current.get(o.blob);
    return face ? [{ ...face, file: names[i] }] : [];
  }));
  const converted = queue.outputs.length > 0 && BROWSER_FONTS.has(faces.current.get(queue.outputs[0].blob)?.target ?? "eot");
  const previews = converted
    ? queue.outputs.map((o) => ({ id: o.id, name: o.name, source: o.blob as Blob | Uint8Array, info: faces.current.get(o.blob)?.info, bytes: o.blob.size }))
    : queue.items.map((it) => {
        const i = inspected[it.id];
        return {
          id: it.id,
          name: it.file.name,
          source: i?.status === "ready" ? (i.value.preview ?? it.file) : null,
          info: i?.status === "ready" ? i.value.info : undefined,
          error: i?.status === "error" ? i.message : undefined,
          bytes: it.file.size,
        };
      });

  const hint = { woff2: t("woff2Hint"), woff: t("woffHint"), ttf: t("ttfHint"), eot: t("eotHint"), svg: t("svgHint") }[target];
  const n = queue.items.length;

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={ACCEPT} formats="TTF, OTF, WOFF, WOFF2, EOT, SVG" />
          {previews.length ? (
            <section className="min-w-0 rounded-2xl border border-line bg-surface" data-testid="font-preview">
              <header className="flex flex-col gap-3 border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">{converted ? t("previewConverted") : t("preview")}</h2>
                <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-end">
                  <TextField label={t("sampleText")} value={sample ?? t("pangram")} onChange={(e) => setSample(e.target.value)} data-testid="sample-text" />
                  <Slider label={t("size")} value={size} onChange={setSize} min={12} max={120} suffix="px" />
                </div>
              </header>
              <ul className="divide-y divide-line">
                {previews.map((p) => (
                  <PreviewRow key={p.id} {...p} text={sample ?? t("pangram")} size={size} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      }
      settings={
        <>
          <Field label={t("format")} hint={hint}>
            <Segmented<FontTarget> label={t("format")} value={target} onChange={setTarget} columns={3} size="sm" options={TARGETS.map((v) => ({ value: v, label: v.toUpperCase() }))} />
          </Field>
          <Field label={t("subset")} hint={t("subsetHint")}>
            <Segmented<Subset>
              label={t("subset")}
              value={subset}
              onChange={setSubset}
              columns={3}
              size="sm"
              options={[
                { value: "all", label: t("subsetAll") },
                { value: "latin", label: t("latin") },
                { value: "latin-ext", label: t("latinExt") },
                { value: "turkish", label: t("turkish") },
                { value: "custom", label: t("custom") },
              ]}
            />
            {subset === "custom" ? (
              <TextField label={t("customChars")} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("customPlaceholder")} data-testid="subset-chars" />
            ) : null}
          </Field>
        </>
      }
      action={<RunButton queue={queue} onRun={run} disabled={subset === "custom" && !custom.trim()} label={n > 1 ? t("convertN", { n, format: label }) : t("convert", { format: label })} />}
      results={
        <Results outputs={queue.outputs} zipName="fonts.zip">
          {css ? (
            <div className="flex min-w-0 flex-col gap-2" data-testid="font-css">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Code2 className="size-4 text-muted" />
                  {t("css")}
                </h3>
                <CopyButton value={css} text />
              </div>
              <p className="text-xs text-muted">{t("cssHint")}</p>
              <pre className="max-h-72 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed">{css}</pre>
            </div>
          ) : null}
        </Results>
      }
    />
  );
}

function PreviewRow({
  name,
  source,
  info,
  error,
  bytes,
  text,
  size,
}: {
  name: string;
  source: Blob | Uint8Array | null;
  info?: FontInfo;
  error?: string;
  bytes: number;
  text: string;
  size: number;
}) {
  const t = useT(s);
  const family = useFontFace(source);
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted">
        <span className="min-w-0 truncate text-sm font-medium text-fg" title={name}>
          {name}
        </span>
        {info ? <span data-testid="font-info">{[info.family, info.style, t("glyphs", { n: info.glyphs }), formatBytes(bytes)].filter(Boolean).join(" · ")}</span> : null}
      </div>
      {error ? (
        <p className="text-xs text-err">{error}</p>
      ) : family === "error" ? (
        <p className="text-xs text-muted">{t("noPreview")}</p>
      ) : family ? (
        <p className="break-words leading-tight" style={{ fontFamily: `"${family}", system-ui`, fontSize: size }} data-testid="font-sample">
          {text}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" />
          {t("reading")}
        </p>
      )}
    </li>
  );
}

/** Loads font bytes with the FontFace API under a throwaway family name. */
function useFontFace(source: Blob | Uint8Array | null): string | null {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    if (!source) return;
    let face: FontFace | null = null;
    let live = true;
    (async () => {
      const name = `preview-${uid()}`;
      const buf = source instanceof Blob ? await source.arrayBuffer() : source.slice().buffer;
      face = new FontFace(name, buf);
      await face.load();
      if (!live) return;
      document.fonts.add(face);
      setFamily(name);
    })().catch(() => live && setFamily("error"));
    return () => {
      live = false;
      if (face) document.fonts.delete(face);
      setFamily(null);
    };
  }, [source]);
  return family;
}
