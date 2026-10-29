import { useEffect, useState } from "react";
import type { EngineProps } from "../../engines";
import { withExt } from "../../lib/files";
import { useLang, useT } from "../../lib/i18n";
import { decodeImage } from "../../lib/image/decode";
import { ctx2d, makeCanvas } from "../../lib/image/encode";
import { PSM, defaultLangs, ocrScale, toPgm, type Psm } from "../../lib/ml/ocr";
import { ocrEngine, recognize, releaseOcr, setOcrParams, type OcrEngine, type OcrResult } from "../../lib/ml/ocr-engine";
import { mapPool } from "../../lib/pool";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { IMAGE_INPUT, IMAGE_LABEL, LangPicker, OcrStatusLine, textBlob, useOcrLoadingText, useTextPreview, wordCount } from "./common";
import { s } from "./strings";

/** Decodes any image (EXIF-upright), sizes it for OCR and hands Tesseract grayscale pixels. */
async function readImage(engine: OcrEngine, file: File): Promise<OcrResult> {
  const img = await decodeImage(file);
  let pgm: Uint8Array;
  try {
    const k = ocrScale(img.width, img.height, "image");
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    g.imageSmoothingQuality = "high";
    g.drawImage(img.source, 0, 0, w, h);
    pgm = toPgm(g.getImageData(0, 0, w, h).data, w, h);
    c.width = c.height = 0;
  } finally {
    img.close();
  }
  return recognize(engine, pgm);
}

export default function OcrTool({ meta }: EngineProps) {
  const t = useT(s);
  const lang = useLang();
  const queue = useQueue();
  const [langs, setLangs] = useState(() => defaultLangs(lang));
  const [psm, setPsm] = useState<Psm>("auto");
  const [combine, setCombine] = useState(false);
  const [count, setCount] = useState<{ n: number; total: number } | null>(null);
  const loadingText = useOcrLoadingText();
  const { extra, preview } = useTextPreview(queue.outputs);
  const n = queue.items.length;
  const langKey = langs.join("+");

  // Warm-up: fetch the language data and start the workers while the user picks files.
  // Debounced so clicking through several languages starts the engine once.
  useEffect(() => {
    const id = setTimeout(() => void ocrEngine(langKey.split("+")).catch(() => {}), 300);
    return () => clearTimeout(id);
  }, [langKey]);
  useEffect(() => releaseOcr, []);

  const note = (r: OcrResult) => (r.text.trim() ? t("wordsConf", { words: wordCount(r.text), conf: Math.round(r.confidence) }) : t("noText"));

  const run = () => {
    const ready = ocrEngine(langs).then(async (e) => {
      await setOcrParams(e, PSM[psm]);
      return e;
    });
    ready.catch(() => {}); // each file reports the failure; this just keeps it from being "unhandled"
    let done = 0;
    const total = queue.items.length;
    const tick = () => setCount({ n: ++done, total });
    setCount({ n: 0, total });

    if (!combine) {
      return queue.runEach(async (file, ctx) => {
        const engine = await ready;
        ctx.signal.throwIfAborted();
        ctx.progress(0.1);
        const r = await readImage(engine, file);
        tick();
        const body = r.text.trim();
        return { name: withExt(file.name, "txt"), blob: textBlob(body ? body + "\n" : ""), note: note(r), sourceSize: undefined };
      }, 4);
    }
    return queue.runAll(async (files, ctx) => {
      const engine = await ready;
      const results = await mapPool(files, engine.workers.length, async (file) => {
        ctx.signal.throwIfAborted();
        const r = await readImage(engine, file);
        tick();
        ctx.progress(done / files.length);
        return r;
      });
      const body =
        files.length === 1
          ? results[0].text.trim()
          : files.map((f, i) => `=== ${f.name} ===\n\n${results[i].text.trim()}`).join("\n\n");
      const words = results.reduce((a, r) => a + wordCount(r.text), 0);
      return [
        {
          name: files.length === 1 ? withExt(files[0].name, "txt") : "extracted-text.txt",
          blob: textBlob(body.trim() ? body + "\n" : ""),
          note: words ? t("wordsConf", { words, conf: Math.round(results.reduce((a, r) => a + r.confidence, 0) / results.length) }) : t("noText"),
        },
      ];
    });
  };

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={IMAGE_INPUT} formats={IMAGE_LABEL} />}
      settings={
        <>
          <LangPicker value={langs} onChange={setLangs} disabled={queue.busy} />
          <OcrStatusLine />
          <Field label={t("layout")} hint={t("psmHint")}>
            <Segmented<Psm>
              label={t("layout")}
              value={psm}
              onChange={setPsm}
              size="sm"
              options={[
                { value: "auto", label: t("psmAuto") },
                { value: "block", label: t("psmBlock") },
                { value: "sparse", label: t("psmSparse") },
              ]}
            />
          </Field>
          {n > 1 ? (
            <Field label={t("output")}>
              <Segmented
                label={t("output")}
                value={combine ? "one" : "each"}
                onChange={(v) => setCombine(v === "one")}
                size="sm"
                columns={2}
                options={[
                  { value: "each", label: t("perFile") },
                  { value: "one", label: t("combined") },
                ]}
              />
            </Field>
          ) : null}
        </>
      }
      action={
        <RunButton
          queue={queue}
          onRun={run}
          label={n > 1 ? t("ocrRunN", { n }) : t("ocrRun")}
          status={loadingText ?? (count && count.total > 1 ? t("imageOf", { n: Math.min(count.n + 1, count.total), total: count.total }) : null)}
        />
      }
      results={
        <Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} extra={extra}>
          {preview}
        </Results>
      }
    />
  );
}
