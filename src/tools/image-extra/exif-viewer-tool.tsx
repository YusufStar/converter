import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, Loader2, MapPin, ShieldOff } from "lucide-react";
import type { EngineProps } from "../../engines";
import { formatBytes, splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { formatDms, formatValue, metadataJson, osmUrl, readGroups, summarize, type Groups } from "../../lib/image-extra/exif";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { TextField } from "../../ui/kit";
import { Link } from "../../ui/link";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { EXIF_ACCEPT, EXIF_FORMATS, ItemPicker, usePreview, useSelection } from "./shared";
import { s } from "./strings";

const metadata = new WeakMap<File, Promise<Groups>>();
function loadGroups(file: File): Promise<Groups> {
  let p = metadata.get(file);
  if (!p) {
    p = file.arrayBuffer().then((b) => readGroups(new Uint8Array(b)));
    metadata.set(file, p);
  }
  return p;
}

function useGroups(file: File | undefined): { groups: Groups | null; error: string | null } {
  const [state, setState] = useState<{ file?: File; groups: Groups | null; error: string | null }>({ groups: null, error: null });
  useEffect(() => {
    if (!file) return;
    let live = true;
    loadGroups(file).then(
      (groups) => live && setState({ file, groups, error: null }),
      (e: unknown) => live && setState({ file, groups: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [file]);
  return state.file === file ? state : { groups: null, error: null };
}

const PNG_HEADER = new Set(["ImageWidth", "ImageHeight", "BitDepth", "ColorType", "Compression", "Filter", "Interlace"]);

/** Anything beyond the structural JFIF / PNG header fields. */
function hasMetadata(g: Groups): boolean {
  return Object.entries(g).some(([group, tags]) => group !== "jfif" && (group !== "ihdr" || Object.keys(tags).some((k) => !PNG_HEADER.has(k))));
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface-2/60 px-3 py-2">
      <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

function RawTags({ groups }: { groups: Groups }) {
  const t = useT(s);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const total = Object.values(groups).reduce((a, tags) => a + Object.keys(tags).length, 0);
  const label = (g: string) => {
    const key = `g_${g}` as keyof typeof s.en;
    return key in s.en ? t(key) : g.toUpperCase();
  };
  const filtered = Object.entries(groups)
    .map(([group, tags]) => [group, Object.entries(tags).filter(([k, v]) => !needle || k.toLowerCase().includes(needle) || formatValue(v).toLowerCase().includes(needle))] as const)
    .filter(([, rows]) => rows.length);
  return (
    <details className="group min-w-0 rounded-2xl border border-line" data-testid="raw-tags">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold select-none">
        <ChevronRight className="size-4 shrink-0 text-muted transition group-open:rotate-90" />
        {t("allTags")}
        <span className="font-normal text-muted">· {total}</span>
      </summary>
      <div className="flex min-w-0 flex-col gap-4 border-t border-line p-4">
        <TextField type="search" placeholder={t("searchTags")} aria-label={t("searchTags")} value={q} onChange={(e) => setQ(e.target.value)} />
        {filtered.length ? (
          filtered.map(([group, rows]) => (
            <section key={group} className="flex min-w-0 flex-col gap-1.5">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {label(group)} <span className="font-normal">· {rows.length}</span>
              </h3>
              <dl className="divide-y divide-line rounded-xl border border-line">
                {rows.map(([k, v]) => (
                  <div key={k} className="grid min-w-0 gap-x-3 gap-y-0.5 px-3 py-2 text-[13px] sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <dt className="min-w-0 font-medium break-words text-muted">{k}</dt>
                    <dd className="min-w-0 font-mono text-xs break-all">{formatValue(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))
        ) : (
          <p className="text-sm text-muted">{t("noMatch", { q })}</p>
        )}
      </div>
    </details>
  );
}

function MetadataView({ file }: { file: File }) {
  const t = useT(s);
  const { groups, error } = useGroups(file);
  const { preview } = usePreview(file);
  if (error) return <p className="px-4 py-6 text-sm text-err">{t("readFailed", { error })}</p>;
  if (!groups)
    return (
      <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" />
        {t("reading")}
      </p>
    );
  const sum = summarize(groups);
  const w = preview?.width;
  const h = preview?.height;
  const mp = w && h ? (w * h) / 1e6 : 0;
  const dims = w && h ? `${w} × ${h} px${mp >= 0.1 ? ` · ${mp.toFixed(1)} MP` : ""}` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-testid="metadata">
      <div className="flex min-w-0 items-center gap-3">
        <span className="checker flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line">
          {preview ? <img src={preview.url} alt="" className="size-full object-contain" /> : <Loader2 className="size-4 animate-spin text-muted" />}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-semibold break-all">{file.name}</span>
          <span className="text-xs text-muted tabular-nums">
            {formatBytes(file.size)}
            {dims ? ` · ${dims}` : ""}
          </span>
        </div>
      </div>

      {sum.gps ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-accent/40 bg-accent-soft/60 p-3" data-testid="gps">
          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-accent-text" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">{t("location")}</span>
              <span className="text-xs text-muted">{t("locationWarn")}</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 font-mono text-[13px] tabular-nums">
            <span>
              {sum.gps.lat.toFixed(6)}, {sum.gps.lon.toFixed(6)}
            </span>
            <span className="text-xs text-muted">
              {formatDms(sum.gps.lat, "N", "S")} · {formatDms(sum.gps.lon, "E", "W")}
              {sum.gps.alt !== undefined ? ` · ${t("altitude")} ${Math.round(sum.gps.alt)} m` : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={osmUrl(sum.gps)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:border-line-strong"
            >
              <ExternalLink className="size-3.5" />
              {t("openMap")}
            </a>
            <Link to="/remove-exif" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-accent-text hover:bg-surface/60">
              <ShieldOff className="size-3.5" />
              {t("removeIt")}
            </Link>
          </div>
        </div>
      ) : null}

      {hasMetadata(groups) ? (
        <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Row label={t("camera")} value={sum.camera} />
          <Row label={t("lens")} value={sum.lens} />
          <Row label={t("exposure")} value={sum.exposure} />
          <Row label={t("focal")} value={sum.focal} />
          <Row label={t("taken")} value={sum.date} />
          <Row label={t("dimensions")} value={dims} />
          <Row label={t("orientation")} value={sum.orientation} />
          <Row label={t("colorProfile")} value={sum.colorProfile} />
          <Row label={t("software")} value={sum.software} />
          <Row label={t("author")} value={sum.author} />
          <Row label={t("copyright")} value={sum.copyright} />
        </dl>
      ) : (
        <p className="rounded-xl bg-surface-2/60 px-3 py-3 text-sm text-muted">{t("noMeta")}</p>
      )}

      {Object.keys(groups).length ? <RawTags groups={groups} /> : null}
    </div>
  );
}

export default function ExifViewerTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [item, select] = useSelection(queue);
  const n = queue.items.length;

  const run = () =>
    queue.runEach(async (file) => {
      const json = metadataJson(file.name, await loadGroups(file));
      return { name: `${splitName(file.name).base}-metadata.json`, blob: new Blob([json], { type: "application/json" }), sourceSize: undefined };
    }, 4);

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <FileInput queue={queue} accept={EXIF_ACCEPT} formats={EXIF_FORMATS} />
          {item ? (
            <section className="min-w-0 rounded-2xl border border-line bg-surface">
              {n > 1 ? (
                <div className="border-b border-line px-4 pt-3 pb-1.5">
                  <ItemPicker items={queue.items} selected={item.id} onSelect={select} />
                </div>
              ) : null}
              <MetadataView key={item.id} file={item.file} />
            </section>
          ) : null}
        </div>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("exportJsonN", { n }) : t("exportJson")} />}
      results={<Results outputs={queue.outputs} zipName={`${meta.slug}.zip`} />}
    />
  );
}
