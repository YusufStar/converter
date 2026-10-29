import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Download, FileIcon, Loader2 } from "lucide-react";
import type { EngineProps } from "../../engines";
import { downloadBlob } from "../../lib/download";
import { formatBytes, splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import {
  DecodeError,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decodeBase64Text,
  decodeUtf8,
  encodeBase64Text,
  extForMime,
  formatBase64,
  hexToText,
  htmlDecode,
  htmlEncode,
  parseDataUri,
  sniffMime,
  toDataUri,
  urlDecode,
  urlEncode,
  urlParts,
  type HexSep,
  type UrlMode,
} from "../../lib/utility/encoding";
import { Dropzone } from "../../ui/files";
import { Button, Segmented, Switch, TextArea, TextField, cx } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { CopyButton, ListCard, Note, Tabs, ValueRow } from "./shared";
import { encStrings } from "./strings";

type Mode = "text" | "file" | "tofile" | "url" | "html" | "hex";
type FileOut = "datauri" | "base64" | "css" | "html";
type EncKey = keyof typeof encStrings.en;

const PREVIEW_LIMIT = 200_000;
const MODES: [Mode, EncKey][] = [
  ["text", "tabText"],
  ["file", "tabFile"],
  ["tofile", "tabToFile"],
  ["url", "tabUrl"],
  ["html", "tabHtml"],
  ["hex", "tabHex"],
];

function errorKey(e: unknown): EncKey {
  const code = e instanceof DecodeError ? e.code : "base64";
  return ({ base64: "errBase64", utf8: "errUtf8", uri: "errUri", hex: "errHex", hexOdd: "errHexOdd" } as const)[code];
}

function useObjectUrl(blob: Blob | null) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

function Pane({
  label,
  value,
  onChange,
  error,
  testId,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  error?: string | null;
  testId: string;
}) {
  const t = useT(encStrings);
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        <div className="-my-1 flex items-center gap-1">
          <span className="text-[11px] text-muted tabular-nums">{t("chars", { n: Array.from(value).length })}</span>
          <CopyButton value={value} label={label} />
        </div>
      </div>
      <TextArea
        id={id}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={!onChange}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!!error}
        className={cx("min-h-44 wrap-anywhere lg:min-h-56", error && "border-err focus:border-err")}
        data-testid={testId}
      />
      {error ? <Note tone="err">{error}</Note> : null}
    </div>
  );
}

/** Two editable panes; whichever was edited last is the source, the other is derived. */
function TwoWay({
  left,
  right,
  initial,
  encode,
  decode,
  below,
}: {
  left: string;
  right: string;
  initial: string;
  encode: (s: string) => string;
  decode: (s: string) => string;
  below?: (plain: string) => ReactNode;
}) {
  const t = useT(encStrings);
  const [src, setSrc] = useState<{ side: "left" | "right"; text: string }>({ side: "left", text: initial });
  let plain = "";
  let coded = "";
  let error: { side: "left" | "right"; key: EncKey } | null = null;
  try {
    if (src.side === "left") {
      plain = src.text;
      coded = encode(plain);
    } else {
      coded = src.text;
      plain = decode(coded);
    }
  } catch (e) {
    error = { side: src.side, key: errorKey(e) };
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Pane label={left} value={plain} onChange={(text) => setSrc({ side: "left", text })} error={error?.side === "left" ? t(error.key) : null} testId="pane-plain" />
        <Pane label={right} value={coded} onChange={(text) => setSrc({ side: "right", text })} error={error?.side === "right" ? t(error.key) : null} testId="pane-encoded" />
      </div>
      {below?.(plain)}
    </div>
  );
}

function UrlPartsCard({ url }: { url: string }) {
  const t = useT(encStrings);
  const parts = urlParts(url);
  if (!parts) return null;
  return (
    <ListCard title={t("urlParts")} testId="url-parts">
      <div className="divide-y divide-line">
        <ValueRow label={t("protocol")} value={parts.protocol} />
        <ValueRow label={t("host")} value={parts.host} />
        <ValueRow label={t("path")} value={parts.path} />
        {parts.params.map(([k, v], i) => (
          <ValueRow key={`${k}-${i}`} label={k} value={v} sub={i === 0 ? t("params") : undefined} />
        ))}
        {parts.hash ? <ValueRow label={t("fragment")} value={parts.hash} /> : null}
      </div>
    </ListCard>
  );
}

function FileToBase64({ wrap }: { wrap: boolean }) {
  const t = useT(encStrings);
  const [file, setFile] = useState<{ name: string; size: number; mime: string; b64: string; blob: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setOut] = useState<FileOut>("datauri");
  const isImage = file?.mime.startsWith("image/") ?? false;
  // CSS and <img> only make sense for images.
  const out: FileOut = !isImage && (picked === "css" || picked === "html") ? "datauri" : picked;
  const preview = useObjectUrl(isImage && file ? file.blob : null);

  const take = async ([f]: File[]) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      setFile({ name: f.name, size: f.size, mime: f.type || sniffMime(bytes.subarray(0, 4096)), b64: bytesToBase64(bytes), blob: f });
    } finally {
      setBusy(false);
    }
  };

  const output = useMemo(() => {
    if (!file) return "";
    const uri = toDataUri(file.mime, file.b64);
    if (out === "base64") return formatBase64(file.b64, { wrap });
    if (out === "css") return `background-image: url("${uri}");`;
    if (out === "html") return `<img src="${uri}" alt="${file.name.replace(/"/g, "&quot;")}" />`;
    return uri;
  }, [file, out, wrap]);
  const shown = output.length > PREVIEW_LIMIT ? `${output.slice(0, PREVIEW_LIMIT)}…` : output;
  const options = (isImage ? (["datauri", "base64", "css", "html"] as const) : (["datauri", "base64"] as const)).map((v) => ({
    value: v as FileOut,
    label: t(({ datauri: "outDataUri", base64: "outBase64", css: "outCss", html: "outHtml" } as const)[v]),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Dropzone onFiles={take} multiple={false} compact={!!file} formats={t("dropHint")} />
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          {t("reading")}
        </p>
      ) : null}
      {file ? (
        <ListCard testId="file-b64">
          <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
            <span className="checker flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line">
              {preview ? <img src={preview} alt="" className="size-full object-contain" /> : <FileIcon className="size-5 text-muted" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </span>
              <span className="text-xs text-muted tabular-nums">
                {file.mime} · {t("fileInfo", { size: formatBytes(file.size), encoded: formatBytes(output.length) })}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="w-full min-w-0 sm:max-w-sm">
                <Segmented<FileOut> label={t("fileOut")} value={out} onChange={setOut} options={options} size="sm" />
              </div>
              <div className="flex shrink-0 gap-2">
                <CopyButton value={output} text />
                <Button size="sm" onClick={() => downloadBlob(new Blob([output], { type: "text/plain" }), `${splitName(file.name).base}.txt`)}>
                  <Download className="size-3.5" />
                  {t("downloadTxt")}
                </Button>
              </div>
            </div>
            <TextArea value={shown} readOnly spellCheck={false} aria-label={t("fileOut")} className="min-h-40 wrap-anywhere" data-testid="file-b64-output" />
            {output.length > PREVIEW_LIMIT ? <Note>{t("truncated", { n: PREVIEW_LIMIT.toLocaleString() })}</Note> : null}
          </div>
        </ListCard>
      ) : null}
      <Note>{t("fileHint")}</Note>
    </div>
  );
}

function Base64ToFile() {
  const t = useT(encStrings);
  const [text, setText] = useState("");
  const [name, setName] = useState("decoded");

  type Decoded = { ok: true; bytes: Uint8Array; mime: string; ext: string; blob: Blob } | { ok: false; error: EncKey };
  const decoded = useMemo((): Decoded | null => {
    if (!text.trim()) return null;
    try {
      const uri = parseDataUri(text);
      // Non-base64 data URIs (data:,Hello%20world) carry percent-encoded text.
      const bytes = uri && !uri.base64 ? new TextEncoder().encode(urlDecode(uri.data)) : base64ToBytes(text);
      const mime = uri?.mime ?? sniffMime(bytes);
      return { ok: true, bytes, mime, ext: extForMime(mime), blob: new Blob([bytes as BlobPart], { type: mime }) };
    } catch (e) {
      return { ok: false, error: errorKey(e) };
    }
  }, [text]);
  const ok = decoded?.ok ? decoded : null;
  const url = useObjectUrl(ok && /^(image|audio|video)\//.test(ok.mime) ? ok.blob : null);
  const textPreview = useMemo(() => {
    if (!ok || !/^(text\/|application\/(json|xml))/.test(ok.mime) || ok.mime === "image/svg+xml") return null;
    try {
      return decodeUtf8(ok.bytes.subarray(0, 4000));
    } catch {
      return new TextDecoder().decode(ok.bytes.subarray(0, 4000));
    }
  }, [ok]);
  const fileName = `${name.trim() || "decoded"}.${ok?.ext ?? "bin"}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TextArea
        label={t("pasteLabel")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("pastePlaceholder")}
        spellCheck={false}
        autoComplete="off"
        className={cx("min-h-44 wrap-anywhere", decoded?.ok === false && "border-err focus:border-err")}
        data-testid="b64-paste"
      />
      {decoded?.ok === false ? <Note tone="err">{t(decoded.error)}</Note> : null}
      {!decoded ? <Note>{t("emptyToFile")}</Note> : null}
      {ok ? (
        <ListCard testId="b64-file">
          <div className="divide-y divide-line">
            <ValueRow label={t("detected")} value={ok.mime} testId="b64-mime" />
            <ValueRow label={t("size")} value={formatBytes(ok.bytes.length)} copy={String(ok.bytes.length)} />
          </div>
          <div className="flex min-w-0 flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <TextField label={t("fileName")} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button variant="primary" onClick={() => downloadBlob(ok.blob, fileName)} data-testid="b64-download">
              <Download className="size-4" />
              <span className="truncate">
                {t("download")} <span className="font-mono text-xs opacity-80">{fileName}</span>
              </span>
            </Button>
          </div>
          {url || textPreview !== null ? (
            <div className="flex flex-col gap-2 border-t border-line p-4">
              <span className="text-xs font-medium text-muted">{t("preview")}</span>
              {ok.mime.startsWith("image/") && url ? (
                <div className="checker flex max-h-80 justify-center overflow-hidden rounded-xl border border-line">
                  <img src={url} alt="" className="max-h-80 max-w-full object-contain" data-testid="b64-preview" />
                </div>
              ) : null}
              {ok.mime.startsWith("audio/") && url ? <audio controls src={url} className="w-full" /> : null}
              {ok.mime.startsWith("video/") && url ? <video controls src={url} className="max-h-80 w-full rounded-xl" /> : null}
              {textPreview !== null ? (
                <pre className="max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs wrap-anywhere whitespace-pre-wrap">{textPreview}</pre>
              ) : null}
            </div>
          ) : null}
        </ListCard>
      ) : null}
    </div>
  );
}

export default function EncodingTool({ meta }: EngineProps) {
  const t = useT(encStrings);
  const [mode, setMode] = useState<Mode>((meta.preset?.mode as Mode | undefined) ?? "text");
  const [urlSafe, setUrlSafe] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [urlMode, setUrlMode] = useState<UrlMode>("component");
  const [plus, setPlus] = useState(false);
  const [nonAscii, setNonAscii] = useState(false);
  const [hexSep, setHexSep] = useState<HexSep>("space");
  const [hexUpper, setHexUpper] = useState(false);

  const body = {
    text: (
      <TwoWay key="text" left={t("plain")} right={t("base64")} initial={t("sampleText")} encode={(s) => encodeBase64Text(s, { urlSafe, wrap })} decode={decodeBase64Text} />
    ),
    file: <FileToBase64 key="file" wrap={wrap} />,
    tofile: <Base64ToFile key="tofile" />,
    url: (
      <TwoWay
        key="url"
        left={t("plain")}
        right={t("urlEncoded")}
        initial={t("sampleUrl")}
        encode={(s) => urlEncode(s, urlMode, plus)}
        decode={(s) => urlDecode(s, urlMode, plus)}
        below={(plain) => <UrlPartsCard url={plain} />}
      />
    ),
    html: <TwoWay key="html" left={t("plain")} right={t("htmlEncoded")} initial={t("sampleHtml")} encode={(s) => htmlEncode(s, nonAscii)} decode={htmlDecode} />,
    hex: (
      <TwoWay
        key="hex"
        left={t("plain")}
        right={t("hex")}
        initial={t("sampleHex")}
        encode={(s) => bytesToHex(new TextEncoder().encode(s), hexSep, hexUpper)}
        decode={hexToText}
      />
    ),
  }[mode];

  const settings = {
    text: (
      <>
        <Switch checked={urlSafe} onChange={setUrlSafe} label={t("urlSafe")} hint={t("urlSafeHint")} />
        <Switch checked={wrap} onChange={setWrap} label={t("wrap")} hint={t("wrapHint")} />
      </>
    ),
    file: <Switch checked={wrap} onChange={setWrap} label={t("wrap")} hint={t("wrapHint")} />,
    tofile: <Note>{t("detectHint")}</Note>,
    url: (
      <>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t("urlMode")}</span>
          <Segmented<UrlMode>
            label={t("urlMode")}
            value={urlMode}
            onChange={setUrlMode}
            size="sm"
            options={[
              { value: "component", label: t("urlComponent") },
              { value: "uri", label: t("urlFull") },
            ]}
          />
          <p className="text-xs leading-relaxed text-muted">{t("urlModeHint")}</p>
        </div>
        <Switch checked={plus} onChange={setPlus} label={t("plus")} hint={t("plusHint")} />
      </>
    ),
    html: <Switch checked={nonAscii} onChange={setNonAscii} label={t("nonAscii")} hint={t("nonAsciiHint")} />,
    hex: (
      <>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t("hexSep")}</span>
          <Segmented<HexSep>
            label={t("hexSep")}
            value={hexSep}
            onChange={setHexSep}
            size="sm"
            columns={4}
            options={[
              { value: "space", label: t("sepSpace") },
              { value: "none", label: t("sepNone") },
              { value: "0x", label: "0x" },
              { value: "\\x", label: "\\x" },
            ]}
          />
        </div>
        <Switch checked={hexUpper} onChange={setHexUpper} label={t("upper")} />
      </>
    ),
  }[mode];

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<Mode> label={t("mode")} value={mode} onChange={setMode} className="grid-cols-3 sm:grid-cols-6" options={MODES.map(([value, key]) => ({ value, label: t(key) }))} />
          {mode === "text" || mode === "url" || mode === "html" || mode === "hex" ? <Note>{t("twoWay")}</Note> : null}
          {body}
        </div>
      }
      settings={settings}
    />
  );
}
