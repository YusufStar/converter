import { useEffect, useState } from "react";
import type { EngineProps } from "../../engines";
import { convertSubtitle, type OutFormat, type TextEncodingId } from "../../lib/dev/subtitle";
import { splitName, withExt } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { useQueue, type Output } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, NumberField, Segmented, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { subS } from "./strings";

type Enc = "auto" | "utf-8" | "windows-1254" | "windows-1252";

const FPS = [23.976, 24, 25, 29.97, 30];
const MIME: Record<OutFormat, string> = { srt: "application/x-subrip", vtt: "text/vtt", sbv: "text/plain", sub: "text/plain" };
const ENC_LABEL: Record<TextEncodingId, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1254": "Windows-1254",
  "windows-1252": "Windows-1252",
};

function FpsPicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <Segmented<number> label={label} value={value} onChange={onChange} size="sm" columns={5} options={FPS.map((f) => ({ value: f, label: String(f) }))} />
    </Field>
  );
}

function Preview({ output }: { output: Output }) {
  const t = useT(subS);
  const [text, setText] = useState("");
  useEffect(() => {
    let live = true;
    void output.blob.text().then((s) => live && setText(s.split("\n").slice(0, 40).join("\n")));
    return () => {
      live = false;
    };
  }, [output]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium text-muted">{t("preview", { name: output.name })}</span>
      <pre className="max-h-72 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere" data-testid="subtitle-preview">
        {text}
      </pre>
    </div>
  );
}

export default function SubtitleTool({ meta }: EngineProps) {
  const t = useT(subS);
  const queue = useQueue();
  const [to, setTo] = useState<OutFormat>((meta.preset?.to as OutFormat | undefined) ?? "srt");
  const [encoding, setEncoding] = useState<Enc>("auto");
  const [shift, setShift] = useState<number | null>(0);
  const [fpsOn, setFpsOn] = useState(false);
  const [fromFps, setFromFps] = useState(25);
  const [toFps, setToFps] = useState(23.976);
  const [subFps, setSubFps] = useState(23.976);
  const [bom, setBom] = useState(false);

  const usesSub = to === "sub" || queue.items.some((i) => splitName(i.file.name).ext === "sub");

  const run = () =>
    queue.runEach(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = convertSubtitle(bytes, splitName(file.name).ext, {
        to,
        encoding,
        shiftMs: shift ?? 0,
        fromFps: fpsOn ? fromFps : null,
        toFps: fpsOn ? toFps : null,
        subFps,
      });
      return {
        name: withExt(file.name, to),
        blob: new Blob([bom ? `﻿${out.text}` : out.text], { type: `${MIME[to]};charset=utf-8` }),
        note: t("note", { from: out.from.toUpperCase(), n: out.cues, enc: ENC_LABEL[out.encoding] }),
      };
    }, 4);

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept=".srt,.vtt,.ass,.ssa,.sbv,.sub" formats="SRT, VTT, ASS, SSA, SBV, SUB" />}
      settings={
        <>
          <Field label={t("to")}>
            <Segmented<OutFormat>
              label={t("to")}
              value={to}
              onChange={setTo}
              columns={4}
              options={(["srt", "vtt", "sbv", "sub"] as const).map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </Field>
          <Field label={t("encoding")} hint={t("encodingHint")}>
            <Segmented<Enc>
              label={t("encoding")}
              value={encoding}
              onChange={setEncoding}
              size="sm"
              columns={2}
              options={[
                { value: "auto", label: t("encAuto") },
                { value: "utf-8", label: "UTF-8" },
                { value: "windows-1254", label: t("encTr") },
                { value: "windows-1252", label: t("encWestern") },
              ]}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <NumberField label={t("shift")} value={shift} onChange={setShift} step={100} suffix="ms" placeholder="0" />
            <p className="text-xs leading-relaxed text-muted">{t("shiftHint")}</p>
          </div>
          <Switch checked={fpsOn} onChange={setFpsOn} label={t("fps")} hint={t("fpsHint")} />
          {fpsOn ? (
            <>
              <FpsPicker label={t("fromFps")} value={fromFps} onChange={setFromFps} />
              <FpsPicker label={t("toFps")} value={toFps} onChange={setToFps} />
            </>
          ) : null}
          {usesSub ? (
            <div className="flex flex-col gap-1.5">
              <FpsPicker label={t("subFps")} value={subFps} onChange={setSubFps} />
              <p className="text-xs leading-relaxed text-muted">{t("subFpsHint")}</p>
            </div>
          ) : null}
          <Switch checked={bom} onChange={setBom} label={t("bom")} hint={t("bomHint")} />
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("convertN", { n }) : t("convertOne")} />}
      results={
        <Results outputs={queue.outputs} zipName="subtitles.zip">
          {queue.outputs[0] ? <Preview output={queue.outputs[0]} /> : null}
        </Results>
      }
    />
  );
}
