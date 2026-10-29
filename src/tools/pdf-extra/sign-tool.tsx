import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CalendarDays, Check, CopyPlus, Loader2, Pencil, Signature, Trash2, Type, type LucideIcon } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EngineProps } from "../../engines";
import { splitName, uid } from "../../lib/files";
import { useLang, useT } from "../../lib/i18n";
import { localeOf } from "../../lib/langs";
import { LINE, signPdf, type Placement } from "../../lib/pdf-extra/sign";
import { ENCRYPTED } from "../../lib/pdf/edit";
import { closePdf, openFile, pdfjs, renderPage } from "../../lib/pdf/pdfjs";
import { errorMessage, useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Button, Field, IconButton, Segmented, cx } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pdfBlob } from "../pdf/common";
import { LoadError } from "./common";
import { INKS, SignatureDialog, type SigImage, type Slot } from "./signature-dialog";
import { s } from "./strings";

type Tool = Slot | "date" | "text";
type DateFormat = "short" | "long" | "iso";

/** Page size in points as displayed (rotation applied). */
interface PageSize {
  w: number;
  h: number;
}

// The preview draws text with the very font the PDF gets, so sizes and widths match.
const FACE = "SignPdfDejaVu";
let faceLoading: Promise<void> | null = null;
function loadFace() {
  faceLoading ??= import("dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url").then(async ({ default: url }) => {
    const face = new FontFace(FACE, `url(${url})`);
    await face.load();
    document.fonts.add(face);
  });
  return faceLoading;
}

let measurer: CanvasRenderingContext2D | null = null;
/** Text advance width in em. */
function textEm(text: string) {
  measurer ??= document.createElement("canvas").getContext("2d")!;
  measurer.font = `100px ${FACE}`;
  return measurer.measureText(text || " ").width / 100;
}

/** Width fraction a text placement needs on a page for its height. */
const textWidth = (text: string, h: number, page: PageSize) => (textEm(text) * ((h * page.h) / LINE)) / page.w;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function today(fmt: DateFormat, lang: string) {
  const d = new Date();
  if (fmt === "iso") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const locale = localeOf(lang);
  return fmt === "long" ? d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : d.toLocaleDateString(locale);
}

const dataUrlBytes = (url: string) => Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));

// pdf.js draws on the main thread: one page at a time keeps scrolling smooth.
let renderChain = Promise.resolve();

interface PageProps {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  items: Placement[];
  images: Record<string, SigImage>;
  selected: string | null;
  armed: boolean;
  onPlace: (page: number, fx: number, fy: number) => void;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Placement>) => void;
  onRemove: (id: string) => void;
}

function PageView({ doc, index, size, items, images, selected, armed, onPlace, onSelect, onChange, onRemove }: PageProps) {
  const t = useT(s);
  const sheet = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);

  // Render once the page comes near the viewport.
  useEffect(() => {
    const el = sheet.current!;
    let alive = true;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        renderChain = renderChain.then(async () => {
          if (!alive) return;
          try {
            const page = await doc.getPage(index + 1);
            const scale = Math.min(3, (el.clientWidth * Math.min(2, window.devicePixelRatio || 1)) / size.w);
            const canvas = await renderPage(page, scale);
            page.cleanup();
            if (!alive) return;
            canvas.className = "absolute inset-0 size-full";
            holder.current?.replaceChildren(canvas);
            setDrawn(true);
          } catch {
            // destroyed document: nothing to draw
          }
        });
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [doc, index, size.w]);

  return (
    <figure className="flex min-w-0 flex-col items-center gap-2">
      <div
        ref={sheet}
        data-testid="sign-page"
        data-page={index + 1}
        aria-label={t("pageN", { n: index + 1 })}
        className={cx(
          "relative w-full overflow-hidden rounded-[3px] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.12),0_8px_24px_-12px_rgb(0_0_0/0.3)] select-none",
          armed ? "cursor-crosshair outline-2 outline-offset-2 outline-accent/50" : "",
        )}
        style={{ aspectRatio: `${size.w} / ${size.h}`, containerType: "inline-size" }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (armed) onPlace(index, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
          else onSelect(null);
        }}
      >
        <div ref={holder} className="absolute inset-0" />
        {!drawn ? <Loader2 className="absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-black/30" aria-hidden /> : null}
        {items.map((it) => (
          <PlacedItem
            key={it.id}
            item={it}
            image={it.kind === "image" ? images[it.image] : undefined}
            size={size}
            selected={selected === it.id}
            onSelect={onSelect}
            onChange={onChange}
            onRemove={onRemove}
          />
        ))}
      </div>
      <figcaption className="text-xs text-muted tabular-nums">{t("pageN", { n: index + 1 })}</figcaption>
    </figure>
  );
}

function PlacedItem({
  item,
  image,
  size,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  item: Placement;
  image?: SigImage;
  size: PageSize;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Placement>) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT(s);
  const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; start: Placement; rect: DOMRect } | null>(null);

  const begin = (mode: "move" | "resize") => (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(item.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.closest("[data-testid=sign-page]")!.getBoundingClientRect();
    drag.current = { mode, x: e.clientX, y: e.clientY, start: item, rect };
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.rect.width;
    const dy = (e.clientY - d.y) / d.rect.height;
    const p = d.start;
    if (d.mode === "move") onChange(item.id, { x: clamp(p.x + dx, 0, 1 - p.w), y: clamp(p.y + dy, 0, 1 - p.h) });
    else {
      // Corner drag keeps the aspect ratio; at least 12 px wide, never past the page edge.
      const ratio = p.h / p.w;
      const w = clamp(p.w + dx, 12 / d.rect.width, Math.min(1 - p.x, (1 - p.y) / ratio));
      onChange(item.id, { w, h: w * ratio });
    }
  };

  const end = () => {
    drag.current = null;
  };

  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.005;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (nudge) {
      e.preventDefault();
      onChange(item.id, { x: clamp(item.x + nudge[0], 0, 1 - item.w), y: clamp(item.y + nudge[1], 0, 1 - item.h) });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(item.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={item.kind === "text" ? item.text : t("signature")}
      aria-pressed={selected}
      data-testid="placement"
      onPointerDown={begin("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => onSelect(item.id)}
      onKeyDown={key}
      className={cx(
        "absolute cursor-move touch-none outline-none",
        selected ? "ring-2 ring-accent ring-offset-1 ring-offset-white" : "hover:ring-1 hover:ring-accent/60",
      )}
      style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%` }}
    >
      {item.kind === "image" ? (
        image ? <img src={image.url} alt="" draggable={false} className="pointer-events-none size-full" /> : null
      ) : (
        <span
          className="pointer-events-none block whitespace-pre"
          style={{ fontFamily: FACE, fontSize: `${((item.h * size.h) / LINE / size.w) * 100}cqw`, lineHeight: LINE, color: item.color }}
        >
          {item.text}
        </span>
      )}
      {selected ? (
        <span
          role="presentation"
          data-testid="resize-handle"
          onPointerDown={begin("resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-accent shadow"
        />
      ) : null}
    </div>
  );
}

function ToolButton({ icon: Icon, label, active, onClick, onEdit, editLabel }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void; onEdit?: () => void; editLabel?: string }) {
  return (
    <div className={cx("flex items-center rounded-[10px]", active && "bg-accent-soft")}>
      <Button size="sm" variant={active ? "primary" : "secondary"} onClick={onClick} aria-pressed={active}>
        <Icon className="size-3.5" />
        {label}
      </Button>
      {onEdit ? (
        <IconButton label={editLabel ?? label} onClick={onEdit}>
          <Pencil className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}

export default function SignTool({ meta }: EngineProps) {
  const t = useT(s);
  const lang = useLang();
  const queue = useQueue({ multiple: false });
  const file = queue.items[0]?.file;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, SigImage>>({});
  const [slots, setSlots] = useState<Record<Slot, string | null>>({ signature: null, initials: null });
  const [items, setItems] = useState<Placement[]>([]);
  const [armed, setArmed] = useState<Tool | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Slot | null>(null);
  const [ink, setInk] = useState<string>(INKS[0][0]);
  const [dateFormat, setDateFormat] = useState<DateFormat>("short");
  const textInput = useRef<HTMLInputElement>(null);

  // Warm up the renderer, pdf-lib and the text font while the visitor picks a file.
  useEffect(() => {
    void pdfjs();
    void import("pdf-lib");
    void loadFace().catch(() => {});
  }, []);

  useEffect(() => {
    setDoc(null);
    setSizes([]);
    setItems([]);
    setSelected(null);
    setLoadError(null);
    if (!file) return;
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    (async () => {
      try {
        opened = await openFile(file);
        // pdf.js opens restricted (owner-password) files, but pdf-lib can't save them: say so now, not after signing.
        if (await opened.getPermissions()) throw new Error(ENCRYPTED);
        const list: PageSize[] = [];
        for (let i = 1; i <= opened.numPages; i++) {
          const vp = (await opened.getPage(i)).getViewport({ scale: 1 });
          list.push({ w: vp.width, h: vp.height });
        }
        if (!alive) return;
        setSizes(list);
        setDoc(opened);
      } catch (e) {
        if (alive) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
      if (opened) void closePdf(opened);
    };
  }, [file]);

  // Esc drops the armed tool or the selection.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || dialog) return;
      setArmed(null);
      setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  const pick = (tool: Tool) => {
    setSelected(null);
    if ((tool === "signature" || tool === "initials") && !slots[tool]) setDialog(tool);
    else setArmed((a) => (a === tool ? null : tool));
  };

  const place = async (page: number, fx: number, fy: number) => {
    const tool = armed;
    const size = sizes[page];
    if (!tool || !size) return;
    let item: Placement;
    const id = uid();
    if (tool === "signature" || tool === "initials") {
      const img = images[slots[tool] ?? ""];
      if (!img) return;
      // Signatures start about a third of the page wide, initials smaller; never taller than a fifth of it.
      let w = tool === "signature" ? 0.3 : 0.12;
      let h = (w * (img.height / img.width) * size.w) / size.h;
      if (h > 0.2) [w, h] = [(w * 0.2) / h, 0.2];
      item = { id, page, kind: "image", image: img.id, x: 0, y: 0, w, h };
    } else {
      await loadFace().catch(() => {});
      const text = tool === "date" ? today(dateFormat, lang) : t("textDefault");
      const h = (13 * LINE) / size.h; // 13 pt text
      item = { id, page, kind: "text", text, color: ink, x: 0, y: 0, w: textWidth(text, h, size), h };
    }
    item.x = clamp(fx - item.w / 2, 0, 1 - item.w);
    item.y = clamp(fy - item.h / 2, 0, 1 - item.h);
    setItems((list) => [...list, item]);
    setArmed(null);
    setSelected(id);
  };

  const change = (id: string, patch: Partial<Placement>) =>
    setItems((list) => list.map((it) => (it.id === id ? ({ ...it, ...patch } as Placement) : it)));

  const remove = (id: string) => {
    setItems((list) => list.filter((it) => it.id !== id));
    setSelected((s) => (s === id ? null : s));
  };

  const sel = items.find((it) => it.id === selected) ?? null;

  // Focus the text box for a freshly placed text or date so typing replaces it.
  useEffect(() => {
    if (sel?.kind === "text") textInput.current?.select();
  }, [sel?.id, sel?.kind]);

  const editText = (text: string) => {
    if (!sel || sel.kind !== "text") return;
    const w = Math.min(textWidth(text, sel.h, sizes[sel.page]), 1);
    change(sel.id, { text, w, x: clamp(sel.x, 0, 1 - w) });
  };

  /** Copies the selection to every other page: same relative spot, same size in points. */
  const toAllPages = () => {
    if (!sel) return;
    const from = sizes[sel.page];
    const copies = sizes.flatMap((to, page) => {
      if (page === sel.page || items.some((it) => it.page === page && it.kind === sel.kind && it.x === sel.x && it.y === sel.y)) return [];
      const w = Math.min(1, (sel.w * from.w) / to.w);
      const h = Math.min(1, (sel.h * from.h) / to.h);
      return [{ ...sel, id: uid(), page, w, h, x: clamp(sel.x, 0, 1 - w), y: clamp(sel.y, 0, 1 - h) }];
    });
    setItems((list) => [...list, ...copies]);
  };

  const run = () =>
    queue.runEach(async (f) => {
      const used = Object.fromEntries(items.flatMap((it) => (it.kind === "image" && images[it.image] ? [[it.image, dataUrlBytes(images[it.image].url)]] : [])));
      const bytes = await signPdf(await f.arrayBuffer(), items, used);
      return { name: `${splitName(f.name).base}-signed.pdf`, blob: pdfBlob(bytes) };
    });

  const tools: { tool: Tool; icon: LucideIcon; label: string; edit?: string }[] = [
    { tool: "signature", icon: Signature, label: t("signature"), edit: t("editSignature") },
    { tool: "initials", icon: Signature, label: t("initials"), edit: t("editInitials") },
    { tool: "date", icon: CalendarDays, label: t("date") },
    { tool: "text", icon: Type, label: t("text") },
  ];

  const toolbar = sel ? (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {sel.kind === "text" ? (
        <>
          <input
            ref={textInput}
            value={sel.text}
            onChange={(e) => editText(e.target.value)}
            aria-label={t("itemText")}
            maxLength={200}
            data-testid="item-text"
            className="h-8 min-w-0 flex-1 basis-40 rounded-lg border border-line bg-surface px-2.5 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-1" role="radiogroup" aria-label={t("ink")}>
            {INKS.map(([color, name]) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={sel.color === color}
                aria-label={t(name)}
                title={t(name)}
                onClick={() => change(sel.id, { color })}
                className={cx("size-6 rounded-full border-2", sel.color === color ? "border-accent" : "border-transparent")}
              >
                <span className="block size-full rounded-full border-2 border-surface" style={{ background: color }} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <span className="min-w-0 flex-1 basis-40 text-xs text-muted">{t("selectedHint")}</span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {sizes.length > 1 ? (
          <Button size="sm" onClick={toAllPages} data-testid="to-all-pages">
            <CopyPlus className="size-3.5" />
            {t("toAllPages")}
          </Button>
        ) : null}
        <Button size="sm" variant="danger" onClick={() => remove(sel.id)}>
          <Trash2 className="size-3.5" />
          {t("deleteItem")}
        </Button>
        <Button size="sm" variant="primary" onClick={() => setSelected(null)}>
          <Check className="size-3.5" />
          {t("doneEditing")}
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" data-testid="sign-tools">
        {tools.map(({ tool, icon, label, edit }) => (
          <ToolButton
            key={tool}
            icon={icon}
            label={label}
            active={armed === tool}
            onClick={() => pick(tool)}
            onEdit={edit && slots[tool as Slot] ? () => setDialog(tool as Slot) : undefined}
            editLabel={edit}
          />
        ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {armed ? t("tapToPlace") : t("pickThenTap")}
      </p>
    </div>
  );

  const viewer = loadError ? (
    <LoadError message={loadError} />
  ) : file && !doc ? (
    <p className="flex items-center gap-2 px-1 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" />
      {t("reading")}
    </p>
  ) : doc ? (
    <>
      <div className="sticky top-16 z-20 rounded-2xl border border-line bg-surface/95 p-2.5 shadow-[0_8px_24px_-16px_rgb(0_0_0/0.4)] backdrop-blur-md lg:top-4" data-testid="sign-toolbar">
        {toolbar}
      </div>
      <div className="flex flex-col gap-6 rounded-2xl bg-surface-2 p-3 sm:p-6">
        {sizes.map((size, i) => (
          <PageView
            key={i}
            doc={doc}
            index={i}
            size={size}
            items={items.filter((it) => it.page === i)}
            images={images}
            selected={selected}
            armed={!!armed}
            onPlace={place}
            onSelect={setSelected}
            onChange={change}
            onRemove={remove}
          />
        ))}
      </div>
    </>
  ) : null;

  const formats: DateFormat[] = ["short", "long", "iso"];

  return (
    <>
      <ToolLayout
        meta={meta}
        input={
          <div className="flex min-w-0 flex-col gap-4">
            <FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" multiple={false} />
            {viewer}
          </div>
        }
        settings={
          <>
            <Field label={t("dateFormat")}>
              <Segmented label={t("dateFormat")} value={dateFormat} onChange={setDateFormat} columns={1} size="sm" options={formats.map((f) => ({ value: f, label: today(f, lang) }))} />
            </Field>
            {items.length ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium" data-testid="placed-count">
                  {items.length === 1 ? t("placedOne") : t("placed", { n: items.length })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setItems([]);
                    setSelected(null);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  {t("clearPlaced")}
                </Button>
              </div>
            ) : null}
            <Hint>{t("signHelp")}</Hint>
          </>
        }
        action={<RunButton queue={queue} onRun={run} label={items.length ? t("signRun") : t("signNeedItem")} disabled={!items.length || !doc} />}
        results={<Results outputs={queue.outputs} />}
      />
      <SignatureDialog
        slot={dialog}
        ink={ink}
        onInk={setInk}
        onClose={() => setDialog(null)}
        onUse={(img) => {
          const slot = dialog!;
          setImages((m) => ({ ...m, [img.id]: img }));
          setSlots((m) => ({ ...m, [slot]: img.id }));
          setDialog(null);
          setArmed(slot);
          setSelected(null);
        }}
      />
    </>
  );
}
