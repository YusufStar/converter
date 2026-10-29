import { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, FileIcon, Folder, FolderTree, Loader2, Lock, ShieldCheck } from "lucide-react";
import type { EngineProps } from "../../engines";
import { buildTree, canExtractFast, extractArchive, type Entry, type TreeNode } from "../../lib/archive/archive";
import { LaError, laExtract, laList, warmUpLibarchive } from "../../lib/archive/libarchive";
import { downloadBlob } from "../../lib/download";
import { formatBytes, splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { errorMessage, useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { IconButton, Switch, TextField, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { s } from "./strings";

// Typed blobs get thumbnails in the results list.
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  zip: "application/zip",
};

const ARCHIVE_ACCEPT = ".zip,.rar,.7z,.tar,.gz,.tgz,.xz,.txz,.bz2,.tbz2,.tbz,.lzma,.tlz,.iso,.cab,.lzh,.lha,.cpio";
const ARCHIVE_FORMATS = "ZIP, RAR, 7Z, TAR, TAR.GZ, TAR.XZ, TAR.BZ2, GZ, ISO, CAB, LZH";

/** "site.tar.gz" → "site", "a.zip" → "a" */
const archiveBase = (name: string) => name.replace(/\.(tar\.(gz|xz|bz2|lzma)|tgz|txz|tbz2?|tlz|tar|zip|gz|rar|7z|iso|cab|lzh|lha|cpio)$/i, "") || name;

const blobOf = (path: string, data: Uint8Array) => new Blob([data as BlobPart], { type: MIME[splitName(path).ext] ?? "" });

// ZIP / TAR / GZ are unpacked once with fflate and reused for the listing, single files and
// "Extract all". ponytail: keeps those files in memory while the archive is queued (bounded by
// the 2 GB cap); list them without unpacking, like libarchive does, if that ever matters.
const fastCache = new WeakMap<File, Promise<Entry[] | null>>();
function unpackFast(file: File): Promise<Entry[] | null> {
  let p = fastCache.get(file);
  if (!p) {
    p = file.arrayBuffer().then((b) => {
      const bytes = new Uint8Array(b);
      return canExtractFast(file.name, bytes) ? extractArchive(file.name, bytes) : null;
    });
    p.catch(() => fastCache.delete(file));
    fastCache.set(file, p);
  }
  return p;
}

interface Listed {
  path: string;
  size: number;
  encrypted: boolean;
}

type Listing = { status: "loading" } | { status: "ready"; entries: Listed[] } | { status: "error"; message: string };

async function listArchive(file: File): Promise<Listed[]> {
  const fast = await unpackFast(file);
  if (fast) return fast.map((e) => ({ path: e.path, size: e.data.length, encrypted: false }));
  return laList(file);
}

async function extractFiles(file: File, opts: { password?: string; paths?: string[] }, signal?: AbortSignal): Promise<{ path: string; data: Uint8Array }[]> {
  const fast = await unpackFast(file);
  if (fast) return opts.paths ? fast.filter((e) => opts.paths!.includes(e.path)) : fast;
  return (await laExtract(file, opts, signal)).map((e) => ({ path: e.path, data: e.data! }));
}

export default function ExtractTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [keep, setKeep] = useState(true);
  const [password, setPassword] = useState("");
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const started = useRef(new Set<string>());

  useEffect(() => warmUpLibarchive(), []);

  const describe = (e: unknown) => {
    if (!(e instanceof LaError)) return errorMessage(e);
    if (e.code === "password-required") return t("needPassword");
    if (e.code === "password-wrong") return t("wrongPassword");
    if (e.code === "encryption-unsupported") return t("encryptedUnsupported");
    if (e.code === "unsupported") return t("unsupported");
    return e.message;
  };

  // List every newly queued archive right away so its contents show before extracting.
  useEffect(() => {
    for (const it of queue.items) {
      if (started.current.has(it.id)) continue;
      started.current.add(it.id);
      setListings((l) => ({ ...l, [it.id]: { status: "loading" } }));
      listArchive(it.file).then(
        (entries) => setListings((l) => ({ ...l, [it.id]: { status: "ready", entries } })),
        (e) => setListings((l) => ({ ...l, [it.id]: { status: "error", message: describe(e) } })),
      );
    }
  });

  const locked = queue.items.some((it) => {
    const l = listings[it.id];
    return l?.status === "ready" && l.entries.some((e) => e.encrypted);
  });
  const pw = password || undefined;

  const run = () => {
    const multi = queue.items.length > 1;
    // One archive at a time: unpacked archives can be large.
    return queue.runEach(async (file, ctx) => {
      let entries;
      try {
        entries = await extractFiles(file, { password: pw }, ctx.signal);
      } catch (e) {
        throw new Error(describe(e));
      }
      if (!entries.length) throw new Error(t("emptyArchive"));
      return entries.map((e) => {
        const slash = e.path.lastIndexOf("/");
        const base = e.path.slice(slash + 1);
        const dir = slash >= 0 ? e.path.slice(0, slash) : "";
        return {
          name: keep ? (multi ? `${archiveBase(file.name)}/${e.path}` : e.path) : base,
          blob: blobOf(base, e.data),
          sourceSize: undefined,
          note: !keep && dir ? t("inFolder", { path: dir }) : undefined,
        };
      });
    }, 1);
  };

  const downloadOne = async (file: File, path: string) => {
    const [entry] = await extractFiles(file, { password: pw, paths: [path] });
    if (!entry) throw new Error(t("emptyArchive"));
    downloadBlob(blobOf(path, entry.data), path.split("/").pop()!);
  };

  const n = queue.items.length;
  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-3">
          <FileInput queue={queue} accept={ARCHIVE_ACCEPT} formats={ARCHIVE_FORMATS} />
          {queue.items.map((it) => (
            <Contents key={it.id} name={it.file.name} listing={listings[it.id]} open={n === 1} onDownload={(path) => downloadOne(it.file, path)} describe={describe} />
          ))}
        </div>
      }
      settings={
        <>
          {locked ? (
            <div className="flex flex-col gap-2 rounded-xl bg-accent-soft/60 p-3">
              <TextField
                label={t("password")}
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="archive-password"
              />
              <p className="flex gap-2 text-xs leading-relaxed text-muted">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("passwordHint")}</span>
              </p>
            </div>
          ) : null}
          <Switch checked={keep} onChange={setKeep} label={t("keepFolders")} hint={t("keepFoldersHint")} />
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("limitNote")}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("extractN", { n }) : t("extract")} />}
      results={<Results outputs={queue.outputs} zipName={n === 1 ? `${archiveBase(queue.items[0].file.name)}.zip` : "extracted.zip"} />}
    />
  );
}

/** One queued archive: its file tree with sizes and a download button per file. */
function Contents({
  name,
  listing,
  open,
  onDownload,
  describe,
}: {
  name: string;
  listing?: Listing;
  open: boolean;
  onDownload: (path: string) => Promise<void>;
  describe: (e: unknown) => string;
}) {
  const t = useT(s);
  const [error, setError] = useState<string | null>(null);
  if (!listing) return null;
  const entries = listing.status === "ready" ? listing.entries : [];
  const total = entries.reduce((a, e) => a + e.size, 0);
  const download = (path: string) =>
    onDownload(path).then(
      () => setError(null),
      (e) => setError(describe(e)),
    );
  return (
    <details open={open} className="group/c min-w-0 rounded-2xl border border-line bg-surface" data-testid="archive-contents">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted transition group-open/c:rotate-90" />
        <FolderTree className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={name}>
          {t("contents")} <span className="font-normal text-muted">· {name}</span>
        </span>
        {listing.status === "ready" ? (
          <span className="shrink-0 text-xs text-muted tabular-nums">{t("contentsCount", { n: entries.length, size: formatBytes(total) })}</span>
        ) : null}
      </summary>
      <div className="border-t border-line">
        {listing.status === "loading" ? (
          <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            {t("reading")}
          </p>
        ) : listing.status === "error" ? (
          <p className="px-4 py-3 text-xs text-err" role="alert">
            {listing.message}
          </p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto py-1" role="tree">
            <Nodes nodes={buildTree(entries)} depth={0} onDownload={download} expand={entries.length <= 200} />
          </ul>
        )}
        {error ? (
          <p className="border-t border-line px-4 py-2 text-xs text-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

const indent = (depth: number) => ({ paddingLeft: 12 + Math.min(depth, 6) * 14 });

type Download = (path: string) => Promise<void>;

function Nodes({ nodes, depth, onDownload, expand }: { nodes: TreeNode[]; depth: number; onDownload: Download; expand: boolean }) {
  return nodes.map((node) =>
    node.children ? (
      <FolderNode key={node.path} node={node} depth={depth} onDownload={onDownload} expand={expand} />
    ) : (
      <FileNode key={node.path} node={node} depth={depth} onDownload={onDownload} />
    ),
  );
}

function FolderNode({ node, depth, onDownload, expand }: { node: TreeNode; depth: number; onDownload: Download; expand: boolean }) {
  // Children render only while open, so huge archives stay cheap.
  const [open, setOpen] = useState(expand && depth === 0);
  return (
    <li role="treeitem" aria-expanded={open}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-surface-2"
        style={indent(depth)}
      >
        <ChevronRight className={cx("size-3.5 shrink-0 text-muted transition", open && "rotate-90")} />
        <Folder className="size-4 shrink-0 text-accent-text" />
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(node.size)}</span>
      </button>
      {open ? (
        <ul role="group">
          <Nodes nodes={node.children!} depth={depth + 1} onDownload={onDownload} expand={expand} />
        </ul>
      ) : null}
    </li>
  );
}

function FileNode({ node, depth, onDownload }: { node: TreeNode; depth: number; onDownload: Download }) {
  const t = useT(s);
  const [busy, setBusy] = useState(false);
  return (
    <li role="treeitem" className="flex min-w-0 items-center gap-2 py-1 pr-2 text-sm hover:bg-surface-2" style={indent(depth)}>
      <span className="size-3.5 shrink-0" />
      <FileIcon className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate" title={node.path}>
        {node.name}
      </span>
      {node.encrypted ? <Lock aria-label={t("locked")} className="size-3.5 shrink-0 text-muted" /> : null}
      <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(node.size)}</span>
      <IconButton
        label={t("downloadFile", { name: node.name })}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onDownload(node.path).finally(() => setBusy(false));
        }}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      </IconButton>
    </li>
  );
}
