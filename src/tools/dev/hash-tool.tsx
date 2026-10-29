import { useEffect, useMemo, useState } from "react";
import { Check, Download, X } from "lucide-react";
import type { EngineProps } from "../../engines";
import { HASH_ALGOS, algoLabel, formatDigest, formatSums, matchDigest, parseExpected, type DigestEncoding, type HashAlgo } from "../../lib/dev/hash";
import { WorkerPool, poolSize } from "../../lib/dev/worker-pool";
import { downloadBlob } from "../../lib/download";
import { formatBytes } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Field, Segmented, TextArea } from "../../ui/kit";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { CopyButton, ListCard, Note, Tabs } from "../utility/shared";
import { Badge, ToggleChips } from "./shared";
import { hashS } from "./strings";

type Mode = "files" | "text";
type Digests = Partial<Record<HashAlgo, Uint8Array>>;

const pool = new WorkerPool(() => new Worker(new URL("../../lib/dev/hash.worker.ts", import.meta.url), { type: "module" }), poolSize(8));
const loadStream = () => import("../../lib/dev/hash-stream");

function DigestRows({ digests, algos, encoding, expected, name }: { digests: Digests; algos: HashAlgo[]; encoding: DigestEncoding; expected: ReturnType<typeof parseExpected>; name?: string }) {
  const t = useT(hashS);
  return (
    <div className="divide-y divide-line">
      {algos.map((a) => {
        const d = digests[a];
        if (!d) return null;
        const value = formatDigest(d, encoding);
        const match = matchDigest(expected, d, name);
        return (
          <div key={a} className="flex min-w-0 items-start gap-2 px-4 py-2.5" data-testid={`digest-${a}`}>
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="shrink-0 text-xs font-medium text-muted sm:w-24">{algoLabel(a)}</span>
              <span className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed wrap-anywhere" data-testid="digest-value">
                {value}
              </span>
            </div>
            {match ? (
              <Badge tone={match === "match" ? "ok" : "err"} testId="digest-match">
                {match === "match" ? <Check className="size-3" /> : <X className="size-3" />}
                {t(match)}
              </Badge>
            ) : null}
            <div className="-my-1">
              <CopyButton value={value} label={algoLabel(a)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function HashTool({ meta }: EngineProps) {
  const t = useT(hashS);
  const queue = useQueue();
  const [mode, setMode] = useState<Mode>((meta.preset?.mode as Mode | undefined) ?? "files");
  const [algos, setAlgos] = useState<HashAlgo[]>(["md5", "sha1", "sha256", "sha512"]);
  const [encoding, setEncoding] = useState<DigestEncoding>("hex");
  const [expectedText, setExpectedText] = useState("");
  const [text, setText] = useState("");
  const [textDigests, setTextDigests] = useState<Digests>({});
  const [fileDigests, setFileDigests] = useState(new Map<File, Digests>());
  const [ran, setRan] = useState<HashAlgo[]>([]);
  const [stats, setStats] = useState<{ n: number; bytes: number; ms: number } | null>(null);
  const expected = useMemo(() => parseExpected(expectedText), [expectedText]);

  // Warm up: the worker script (with hash-wasm) for files, the hashers for text.
  useEffect(() => {
    if (mode === "files") pool.warm();
    else void loadStream();
  }, [mode]);

  const algoKey = algos.join(",");
  useEffect(() => {
    if (mode !== "text") return;
    let live = true;
    const list = algoKey ? (algoKey.split(",") as HashAlgo[]) : [];
    loadStream()
      .then(({ hashBlob }) => hashBlob(new Blob([text]), list))
      .then((d) => live && setTextDigests(d));
    return () => {
      live = false;
    };
  }, [mode, text, algoKey]);

  const run = async () => {
    const list = algos;
    const files = queue.items.map((i) => i.file);
    const started = performance.now();
    setFileDigests(new Map());
    setRan(list);
    setStats(null);
    await queue.runEach(async (file, ctx) => {
      const d = await pool.run<Digests>({ file, algos: list }, { onProgress: ctx.progress, signal: ctx.signal });
      setFileDigests((prev) => new Map(prev).set(file, d));
      return [];
    }, pool.size);
    setStats({ n: files.length, bytes: files.reduce((a, f) => a + f.size, 0), ms: performance.now() - started });
  };

  const fileRows = queue.items.filter((i) => fileDigests.has(i.file)).map((i) => ({ name: i.file.name, digests: fileDigests.get(i.file)! }));
  const sums = mode === "text" ? formatSums([{ name: "-", digests: textDigests }], algos.filter((a) => textDigests[a])) : fileRows.length ? formatSums(fileRows, ran) : "";
  const exportName = (mode === "text" ? algos : ran).length === 1 ? `${(mode === "text" ? algos : ran)[0].replace("-", "")}sums.txt` : "checksums.txt";
  const exportActions = (
    <div className="flex flex-wrap gap-2">
      <CopyButton value={sums} text />
      <Button size="sm" onClick={() => downloadBlob(new Blob([sums], { type: "text/plain" }), exportName)} disabled={!sums} data-testid="hash-export">
        <Download className="size-3.5" />
        {t("exportTxt")}
      </Button>
    </div>
  );

  const n = queue.items.length;
  const speed = stats && stats.ms > 0 ? formatBytes((stats.bytes / stats.ms) * 1000) : "";

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<Mode>
            label={t("mode")}
            value={mode}
            onChange={setMode}
            className="grid-cols-2 sm:max-w-xs"
            options={[
              { value: "files", label: t("tabFiles") },
              { value: "text", label: t("tabText") },
            ]}
          />
          {mode === "files" ? (
            <>
              <FileInput queue={queue} />
              <Note>{t("workers", { n: pool.size })}</Note>
            </>
          ) : (
            <>
              <TextArea label={t("textLabel")} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("textPlaceholder")} spellCheck={false} className="min-h-32" data-testid="hash-text" />
              <Note>{t("textNote")}</Note>
            </>
          )}
        </div>
      }
      settings={
        <>
          <Field label={t("algorithms")} hint={algos.length ? t("algorithmsHint") : <span className="text-err">{t("pickOne")}</span>}>
            <ToggleChips<HashAlgo> label={t("algorithms")} className="grid-cols-2" values={algos} onChange={setAlgos} options={HASH_ALGOS.map((a) => ({ value: a.id, label: a.label }))} />
          </Field>
          <Field label={t("output")}>
            <Segmented<DigestEncoding>
              label={t("output")}
              value={encoding}
              onChange={setEncoding}
              size="sm"
              columns={3}
              options={[
                { value: "hex", label: t("lower") },
                { value: "HEX", label: t("upper") },
                { value: "base64", label: t("base64") },
              ]}
            />
          </Field>
          <Field label={t("expected")} hint={t("expectedHint")} htmlFor="hash-expected">
            <TextArea
              id="hash-expected"
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
              placeholder={t("expectedPlaceholder")}
              spellCheck={false}
              className="min-h-20 text-xs"
              data-testid="hash-expected"
            />
          </Field>
        </>
      }
      action={
        mode === "files" ? <RunButton queue={queue} onRun={run} label={n > 1 ? t("hashN", { n }) : t("hash")} disabled={!algos.length} /> : undefined
      }
      results={
        mode === "text" ? (
          algos.length ? (
            <ListCard title={t("digests")} actions={exportActions} testId="hash-results">
              <DigestRows digests={textDigests} algos={algos} encoding={encoding} expected={expected} />
            </ListCard>
          ) : null
        ) : fileRows.length ? (
          <div className="flex min-w-0 flex-col gap-3" data-testid="hash-results">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted tabular-nums" data-testid="hash-stats">
                {stats
                  ? t(stats.n === 1 ? "summaryOne" : "summary", { n: stats.n, size: formatBytes(stats.bytes), time: (stats.ms / 1000).toFixed(2), speed })
                  : null}
              </span>
              {exportActions}
            </div>
            {queue.items.map((item) => {
              const d = fileDigests.get(item.file);
              if (!d) return null;
              return (
                <ListCard
                  key={item.id}
                  testId="hash-file"
                  title={
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="break-all">{item.file.name}</span>
                      <span className="text-xs font-normal text-muted tabular-nums">{formatBytes(item.file.size)}</span>
                    </span>
                  }
                >
                  <DigestRows digests={d} algos={ran} encoding={encoding} expected={expected} name={item.file.name} />
                </ListCard>
              );
            })}
            <Note>{t("exportHint")}</Note>
          </div>
        ) : null
      }
    />
  );
}
