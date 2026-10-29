import { useEffect, useState } from "react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useLang, useT } from "../../lib/i18n";
import { ctx2d } from "../../lib/image/encode";
import { PSM, addTextLayers, defaultLangs, ocrScale, toPgm, type Psm } from "../../lib/ml/ocr";
import { ocrEngine, recognize, releaseOcr, setOcrParams } from "../../lib/ml/ocr-engine";
import { closePdf, openFile, pageText, renderPage } from "../../lib/pdf/pdfjs";
import { mapPool } from "../../lib/pool";
import { useQueue, type OutputInit } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Segmented, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, LangPicker, OcrStatusLine, textBlob, useOcrLoadingText, useTextPreview, wordCount } from "./common";
import { s } from "./strings";

type Out = "pdf" | "txt" | "both";

// ponytail: a page "has text" past this many characters, so a scanner's tiny footer stamp
// ("Scanned with …") doesn't stop the scan under it from being read.
const HAS_TEXT = 50;

export default function PdfOcrTool({ meta }: EngineProps) {
  const t = useT(s);
  const lang = useLang();
  const queue = useQueue();
  const [langs, setLangs] = useState(() => defaultLangs(lang));
  const [psm, setPsm] = useState<Psm>("auto");
  const [out, setOut] = useState<Out>("pdf");
  const [skipText, setSkipText] = useState(true);
  const [page, setPage] = useState<{ n: number; total: number } | null>(null);
  const loadingText = useOcrLoadingText();
  const { extra, preview } = useTextPreview(queue.outputs);
  const n = queue.items.length;
  const langKey = langs.join("+");

  useEffect(() => {
    const id = setTimeout(() => void ocrEngine(langKey.split("+")).catch(() => {}), 300);
    return () => clearTimeout(id);
  }, [langKey]);
  useEffect(() => releaseOcr, []);

  const run = () => {
    const ready = ocrEngine(langs).then(async (e) => {
      await setOcrParams(e, PSM[psm]);
      return e;
    });
    ready.catch(() => {});
    const wantPdf = out !== "txt";
    const wantTxt = out !== "pdf";

    // One PDF at a time: its pages already keep every worker busy.
    return queue.runEach(async (file, ctx) => {
      const engine = await ready;
      const doc = await openFile(file);
      const total = doc.numPages;
      const texts: string[] = new Array(total).fill("");
      const layers = new Map<number, Uint8Array>();
      let done = 0;
      try {
        setPage({ n: 0, total });
        // As many pages in flight as workers: each holds one ~300 dpi page bitmap at most.
        await mapPool([...Array(total).keys()], engine.workers.length, async (i) => {
          ctx.signal.throwIfAborted();
          const pg = await doc.getPage(i + 1);
          try {
            if (skipText) {
              const existing = await pageText(pg);
              if (existing.replace(/\s/g, "").length >= HAS_TEXT) {
                texts[i] = existing;
                return;
              }
            }
            const v = pg.getViewport({ scale: 1 });
            const canvas = await renderPage(pg, ocrScale(v.width, v.height, "pdf"), { signal: ctx.signal });
            const pgm = toPgm(ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            canvas.width = canvas.height = 0;
            const r = await recognize(engine, pgm, wantPdf);
            texts[i] = r.text.trim();
            if (r.pdf) layers.set(i, r.pdf);
          } finally {
            pg.cleanup();
            done++;
            setPage({ n: done, total });
            ctx.progress((done / total) * (wantPdf ? 0.95 : 1));
          }
        });
      } finally {
        await closePdf(doc);
      }

      const base = splitName(file.name).base;
      const body = texts.join("\n\n").trim();
      const results: OutputInit[] = [];
      if (wantPdf) {
        const bytes = await addTextLayers(new Uint8Array(await file.arrayBuffer()), layers);
        results.push({
          name: `${base}-ocr.pdf`,
          blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
          note: t("pagesOcrd", { n: layers.size, total }),
        });
      }
      if (wantTxt) {
        results.push({
          name: `${base}.txt`,
          blob: textBlob(body ? body + "\n" : ""),
          note: body ? t("words", { n: wordCount(body).toLocaleString() }) : t("noText"),
          sourceSize: undefined,
        });
      }
      return results;
    }, 1);
  };

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept=".pdf,application/pdf" formats="PDF" />}
      settings={
        <>
          <LangPicker value={langs} onChange={setLangs} disabled={queue.busy} />
          <OcrStatusLine />
          <Field label={t("output")}>
            <Segmented<Out>
              label={t("output")}
              value={out}
              onChange={setOut}
              size="sm"
              options={[
                { value: "pdf", label: t("outPdf") },
                { value: "txt", label: t("outTxt") },
                { value: "both", label: t("outBoth") },
              ]}
            />
          </Field>
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
          <Switch checked={skipText} onChange={setSkipText} label={t("skipText")} hint={t("skipTextHint")} />
          <Hint>{t("pdfHint")}</Hint>
        </>
      }
      action={
        <RunButton
          queue={queue}
          onRun={run}
          label={out === "txt" ? t("pdfTxtRun") : n > 1 ? t("pdfRunN", { n }) : t("pdfRun")}
          status={loadingText ?? (page ? t("pageOf", { n: Math.min(page.n + 1, page.total), total: page.total }) : null)}
        />
      }
      results={
        <Results outputs={queue.outputs} zipName={n === 1 ? `${splitName(queue.items[0].file.name).base}.zip` : `${meta.slug}.zip`} extra={extra}>
          {preview}
        </Results>
      }
    />
  );
}
