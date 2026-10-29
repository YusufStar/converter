import { memo, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowLeft, ArrowLeftRight, ArrowRight, FileWarning, Loader2, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { canvasToBlob } from "../../lib/image/encode";
import { organizePdf } from "../../lib/pdf/edit";
import { closePdf, openFile, renderPage } from "../../lib/pdf/pdfjs";
import { errorMessage, useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, IconButton, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pagesLabel, pdfBlob } from "./common";
import { s } from "./strings";

interface Card {
  /** 0-based page index in the source PDF (also the stable key). */
  index: number;
  /** Extra clockwise rotation, any multiple of 90 (kept unwrapped so CSS animates the short way). */
  rotate: number;
  removed: boolean;
}

const THUMB_PX = 260;

/**
 * Lazily renders page thumbnails one at a time (pdf.js draws on the main
 * thread, so a serial queue keeps scrolling smooth) and caches blob URLs.
 */
function useThumbnails(doc: PDFDocumentProxy | null) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const state = useRef({ asked: new Set<number>(), chain: Promise.resolve(), made: [] as string[] });

  useEffect(() => {
    const st = { asked: new Set<number>(), chain: Promise.resolve(), made: [] as string[] };
    state.current = st;
    setUrls({});
    return () => st.made.forEach((u) => URL.revokeObjectURL(u));
  }, [doc]);

  const request = useCallback(
    (index: number) => {
      const st = state.current;
      if (!doc || st.asked.has(index)) return;
      st.asked.add(index);
      st.chain = st.chain.then(async () => {
        if (state.current !== st) return; // document changed meanwhile
        try {
          const page = await doc.getPage(index + 1);
          const v = page.getViewport({ scale: 1 });
          const scale = (THUMB_PX * Math.min(2, window.devicePixelRatio || 1)) / Math.max(v.width, v.height);
          const canvas = await renderPage(page, scale);
          const blob = await canvasToBlob(canvas, "image/jpeg", 0.82);
          canvas.width = canvas.height = 0;
          page.cleanup();
          if (state.current !== st) return;
          const url = URL.createObjectURL(blob);
          st.made.push(url);
          setUrls((u) => ({ ...u, [index]: url }));
        } catch {
          // Destroyed document or a page pdf.js can't draw: the card keeps its placeholder.
        }
      });
    },
    [doc],
  );

  return { urls, request };
}

type Drop = { at: number; after: boolean } | null;

interface CardProps {
  card: Card;
  pos: number;
  count: number;
  url?: string;
  dragging: boolean;
  drop: "before" | "after" | null;
  onVisible: (index: number) => void;
  onEdit: (pos: number, patch: Partial<Card>) => void;
  onMove: (from: number, to: number) => void;
  onDragStart: (pos: number) => void;
  onDragOver: (pos: number, after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

const PageCard = memo(function PageCard({ card, pos, count, url, dragging, drop, onVisible, onEdit, onMove, onDragStart, onDragOver, onDrop, onDragEnd }: CardProps) {
  const t = useT(s);
  const ref = useRef<HTMLLIElement>(null);
  const n = card.index + 1;
  const turned = ((card.rotate % 360) + 360) % 360;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && onVisible(card.index), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [card.index, onVisible]);

  return (
    <li
      ref={ref}
      draggable
      data-testid="page-card"
      data-page={n}
      aria-label={t("pageN", { n })}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(n)); // Firefox needs data to start a drag
        onDragStart(pos);
      }}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(pos, e.clientX > r.left + r.width / 2);
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cx(
        "group relative flex min-w-0 animate-rise cursor-grab flex-col gap-1.5 rounded-xl border bg-surface p-2 transition duration-200 ease-out-soft active:cursor-grabbing",
        dragging ? "scale-95 border-accent opacity-40" : "border-line hover:border-line-strong hover:shadow-[0_6px_20px_-10px_rgb(0_0_0/0.25)]",
      )}
    >
      {drop ? (
        <span aria-hidden className={cx("absolute inset-y-2 w-1 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]", drop === "before" ? "-left-[9px]" : "-right-[9px]")} />
      ) : null}
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-surface-2 p-2">
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className={cx(
              "max-h-full max-w-full rounded-[2px] bg-white object-contain shadow-[0_1px_3px_rgb(0_0_0/0.18)] transition duration-300 ease-out-soft",
              card.removed && "opacity-30 grayscale",
            )}
            style={{ transform: `rotate(${card.rotate}deg)` }}
          />
        ) : (
          <span className="flex aspect-[1/1.414] h-4/5 animate-pulse items-center justify-center rounded-[2px] bg-surface">
            <Loader2 className="size-4 animate-spin text-muted" aria-hidden />
          </span>
        )}
        {card.removed ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-md bg-err px-2 py-0.5 text-xs font-semibold text-white shadow">{t("removed")}</span>
          </span>
        ) : null}
        {turned && !card.removed ? (
          <span className="absolute top-1.5 right-1.5 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-accent-fg tabular-nums">
            {turned}°
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span className={cx("text-xs font-medium tabular-nums", card.removed && "text-muted line-through")}>{t("pageN", { n })}</span>
        <span className="font-mono text-[10.5px] text-muted tabular-nums">#{pos + 1}</span>
      </div>
      <div className="grid grid-cols-5 gap-0.5">
        <IconButton className="size-7 w-full" label={t("rotateLeftN", { n })} onClick={() => onEdit(pos, { rotate: card.rotate - 90 })} disabled={card.removed}>
          <RotateCcw className="size-3.5" />
        </IconButton>
        <IconButton className="size-7 w-full" label={t("rotateRightN", { n })} onClick={() => onEdit(pos, { rotate: card.rotate + 90 })} disabled={card.removed}>
          <RotateCw className="size-3.5" />
        </IconButton>
        <IconButton className="size-7 w-full" label={t("moveLeftN", { n })} onClick={() => onMove(pos, pos - 1)} disabled={pos === 0}>
          <ArrowLeft className="size-3.5" />
        </IconButton>
        <IconButton className="size-7 w-full" label={t("moveRightN", { n })} onClick={() => onMove(pos, pos + 1)} disabled={pos === count - 1}>
          <ArrowRight className="size-3.5" />
        </IconButton>
        {card.removed ? (
          <IconButton className="size-7 w-full text-accent-text" label={t("restoreN", { n })} onClick={() => onEdit(pos, { removed: false })}>
            <Undo2 className="size-3.5" />
          </IconButton>
        ) : (
          <IconButton className="size-7 w-full hover:bg-err/10 hover:text-err" label={t("deleteN", { n })} onClick={() => onEdit(pos, { removed: true })}>
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
      </div>
    </li>
  );
});

const fresh = (count: number): Card[] => Array.from({ length: count }, (_, index) => ({ index, rotate: 0, removed: false }));

export default function OrganizeTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue({ multiple: false });
  const file = queue.items[0]?.file ?? null;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const { urls, request } = useThumbnails(doc);

  useEffect(() => {
    setDoc(null);
    setCards([]);
    setLoadError(null);
    if (!file) return;
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    openFile(file)
      .then((d) => {
        opened = d;
        if (!alive) return void closePdf(d);
        setDoc(d);
        setCards(fresh(d.numPages));
      })
      .catch((e) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
      if (opened) void closePdf(opened);
    };
  }, [file]);

  // Any edit makes earlier results stale.
  const { outputs, setOutputs } = queue;
  const change = useCallback(
    (fn: (cs: Card[]) => Card[]) => {
      setCards(fn);
      if (outputs.length) setOutputs([]);
    },
    [outputs.length, setOutputs],
  );

  const edit = useCallback((pos: number, patch: Partial<Card>) => change((cs) => cs.map((c, i) => (i === pos ? { ...c, ...patch } : c))), [change]);
  const move = useCallback(
    (from: number, to: number) =>
      change((cs) => {
        if (to < 0 || to >= cs.length || from === to) return cs;
        const next = [...cs];
        const [c] = next.splice(from, 1);
        next.splice(to, 0, c);
        return next;
      }),
    [change],
  );

  const onDragOver = useCallback((pos: number, after: boolean) => setDrop((d) => (d?.at === pos && d.after === after ? d : { at: pos, after })), []);
  const onDragEnd = useCallback(() => {
    setDragFrom(null);
    setDrop(null);
  }, []);
  const onDrop = useCallback(() => {
    if (dragFrom !== null && drop) {
      const target = drop.at + (drop.after ? 1 : 0);
      move(dragFrom, target > dragFrom ? target - 1 : target);
    }
    onDragEnd();
  }, [dragFrom, drop, move, onDragEnd]);

  const kept = cards.filter((c) => !c.removed).length;
  const dirty = cards.some((c, i) => c.index !== i || c.rotate % 360 !== 0 || c.removed);

  const run = () =>
    queue.runAll(async (files) => {
      const edits = cards.filter((c) => !c.removed).map((c) => ({ index: c.index, rotate: c.rotate }));
      const bytes = await organizePdf(await files[0].arrayBuffer(), edits);
      return [{ name: `${splitName(files[0].name).base}-organized.pdf`, blob: pdfBlob(bytes), note: pagesLabel(t, edits.length) }];
    });

  const grid = file ? (
    loadError ? (
      <p className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-6 text-sm text-err" role="alert">
        <FileWarning className="size-4 shrink-0" />
        {loadError}
      </p>
    ) : !doc ? (
      <p className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-10 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" />
        {t("loadingPages")}
      </p>
    ) : (
      <section className="min-w-0 rounded-2xl border border-line bg-surface p-3 sm:p-4">
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 sm:gap-4" data-testid="page-grid" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}>
          {cards.map((card, pos) => (
            <PageCard
              key={card.index}
              card={card}
              pos={pos}
              count={cards.length}
              url={urls[card.index]}
              dragging={dragFrom === pos}
              drop={drop?.at === pos && dragFrom !== null ? (drop.after ? "after" : "before") : null}
              onVisible={request}
              onEdit={edit}
              onMove={move}
              onDragStart={setDragFrom}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))}
        </ol>
      </section>
    )
  ) : null;

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" multiple={false} />
          {grid}
        </div>
      }
      settings={
        <>
          {doc ? (
            <p className="text-sm font-medium tabular-nums" data-testid="kept">
              {t("keptOf", { kept, total: cards.length })}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">{t("rotateAll")}</span>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => change((cs) => cs.map((c) => ({ ...c, rotate: c.rotate - 90 })))} disabled={!doc}>
                <RotateCcw className="size-3.5" />
                {t("left")}
              </Button>
              <Button size="sm" onClick={() => change((cs) => cs.map((c) => ({ ...c, rotate: c.rotate + 90 })))} disabled={!doc}>
                <RotateCw className="size-3.5" />
                {t("right")}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="ghost" onClick={() => change((cs) => [...cs].reverse())} disabled={!doc || cards.length < 2}>
              <ArrowLeftRight className="size-3.5" />
              <span className="truncate">{t("reverse")}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => change(() => fresh(cards.length))} disabled={!doc || !dirty}>
              <Undo2 className="size-3.5" />
              {t("reset")}
            </Button>
          </div>
          <Hint>{t("organizeHelp")}</Hint>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={kept || !doc ? t("saveRun") : t("noPagesLeft")} disabled={!doc || kept === 0} />}
      results={<Results outputs={queue.outputs} />}
    />
  );
}
