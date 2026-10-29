import { useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { EngineProps } from "../../engines";
import { MAX_COUNT, NANOID_ALPHABETS, generateIds, ulidTime, uuidv7Time, type IdKind } from "../../lib/dev/ids";
import { downloadBlob } from "../../lib/download";
import { useLang, useT } from "../../lib/i18n";
import { localeOf } from "../../lib/langs";
import { Button, Field, NumberField, Segmented, Slider, Switch, TextField } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { CopyButton, ListCard, Note, Tabs } from "../utility/shared";
import { devCommon, uuidS } from "./strings";

type Alpha = keyof typeof NANOID_ALPHABETS | "custom";

const ALPHA_LABEL: Record<Alpha, keyof typeof uuidS.en> = {
  urlSafe: "alphaUrl",
  alphanumeric: "alphaAlnum",
  lowercase: "alphaLower",
  hex: "alphaHex",
  numbers: "alphaNum",
  custom: "alphaCustom",
};

export default function UuidTool({ meta }: EngineProps) {
  const t = useT(uuidS);
  const tc = useT(devCommon);
  const lang = useLang();
  const [kind, setKind] = useState<IdKind>((meta.preset?.kind as IdKind | undefined) ?? "v4");
  const [count, setCount] = useState<number | null>(1);
  const [upper, setUpper] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [braces, setBraces] = useState(false);
  const [size, setSize] = useState(21);
  const [alpha, setAlpha] = useState<Alpha>("urlSafe");
  const [custom, setCustom] = useState("abcdef123456");
  const [nonce, setNonce] = useState(0);

  const alphabet = alpha === "custom" ? custom : NANOID_ALPHABETS[alpha];
  const result = useMemo(() => {
    try {
      return { ids: generateIds(kind, count ?? 1, { upper, hyphens, braces, size, alphabet }), error: false };
    } catch {
      return { ids: [], error: true };
    }
    // `nonce` re-rolls the same settings.
  }, [kind, count, upper, hyphens, braces, size, alphabet, nonce]);
  const { ids } = result;
  const all = ids.join("\n");
  const first = ids[0] ?? "";
  const time = kind === "v7" ? uuidv7Time(first) : kind === "ulid" ? ulidTime(first) : null;
  const bits = kind === "nanoid" ? Math.floor(size * Math.log2(new Set(alphabet).size || 1)) : null;
  const hint = { v4: t("v4Hint"), v7: t("v7Hint"), ulid: t("ulidHint"), nanoid: t("nanoidHint") }[kind];

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<IdKind>
            label={t("kind")}
            value={kind}
            onChange={setKind}
            className="grid-cols-2 sm:grid-cols-4"
            options={(["v4", "v7", "ulid", "nanoid"] as const).map((k) => ({ value: k, label: t(k) }))}
          />
          <Note>{hint}</Note>
          {result.error ? <Note tone="err">{t("alphabetError")}</Note> : null}
          {ids.length === 1 ? (
            <ListCard testId="id-single">
              <div className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 font-mono text-lg font-medium wrap-anywhere sm:text-xl" data-testid="id-value">
                  {first}
                </span>
                <div className="flex shrink-0 gap-2">
                  <CopyButton value={first} text />
                  <Button size="sm" onClick={() => setNonce((n) => n + 1)} data-testid="id-regenerate">
                    <RefreshCw className="size-3.5" />
                    {t("generate")}
                  </Button>
                </div>
              </div>
              {time !== null || bits !== null ? (
                <p className="border-t border-line px-4 py-2.5 text-xs text-muted" data-testid="id-meta">
                  {time !== null ? t("created", { time: new Date(time).toLocaleString(localeOf(lang), { dateStyle: "medium", timeStyle: "medium" }) }) : t("entropy", { bits: bits! })}
                </p>
              ) : null}
            </ListCard>
          ) : ids.length ? (
            <ListCard
              title={t("idsCount", { n: ids.length })}
              testId="id-list"
              actions={
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={all} text />
                  <Button size="sm" onClick={() => downloadBlob(new Blob([`${all}\n`], { type: "text/plain" }), `${kind === "v4" || kind === "v7" ? `uuid-${kind}` : kind}.txt`)} data-testid="id-download">
                    <Download className="size-3.5" />
                    {tc("downloadTxt")}
                  </Button>
                  <Button size="sm" onClick={() => setNonce((n) => n + 1)} data-testid="id-regenerate">
                    <RefreshCw className="size-3.5" />
                    {t("generate")}
                  </Button>
                </div>
              }
            >
              <pre className="max-h-[480px] overflow-auto p-4 font-mono text-[13px] leading-relaxed" data-testid="id-output">
                {all}
              </pre>
            </ListCard>
          ) : null}
        </div>
      }
      settings={
        <>
          <NumberField label={t("count")} value={count} onChange={(v) => setCount(v === null ? null : Math.max(1, Math.min(MAX_COUNT, Math.round(v))))} min={1} max={MAX_COUNT} step={1} suffix={`/ ${MAX_COUNT}`} />
          {kind === "v4" || kind === "v7" ? (
            <>
              <Switch checked={upper} onChange={setUpper} label={t("uppercase")} />
              <Switch checked={hyphens} onChange={setHyphens} label={t("hyphens")} />
              <Switch checked={braces} onChange={setBraces} label={t("braces")} />
            </>
          ) : null}
          {kind === "nanoid" ? (
            <>
              <Slider label={t("size")} value={size} onChange={setSize} min={4} max={64} />
              <Field label={t("alphabet")}>
                <Segmented<Alpha>
                  label={t("alphabet")}
                  value={alpha}
                  onChange={setAlpha}
                  size="sm"
                  columns={3}
                  options={(Object.keys(ALPHA_LABEL) as Alpha[]).map((a) => ({ value: a, label: t(ALPHA_LABEL[a]) }))}
                />
              </Field>
              {alpha === "custom" ? <TextField label={t("customAlphabet")} value={custom} onChange={(e) => setCustom(e.target.value)} spellCheck={false} className="font-mono" /> : null}
            </>
          ) : null}
        </>
      }
    />
  );
}
