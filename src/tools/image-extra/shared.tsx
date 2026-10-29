import { useEffect, useState } from "react";
import { FileIcon } from "lucide-react";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { decodeImage } from "../../lib/image/decode";
import { canvasToBlob } from "../../lib/image/encode";
import { useObjectUrl } from "../../lib/use-object-url";
import type { Queue, QueueItem } from "../../lib/use-queue";
import { cx } from "../../ui/kit";
import { s } from "./strings";

export const EXIF_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,image/avif,.jpg,.jpeg,.jfif,.png,.webp,.heic,.heif,.tif,.tiff,.avif";
export const EXIF_FORMATS = "JPG, PNG, WEBP, HEIC, TIFF, AVIF";
export const RASTER_ACCEPT = "image/*,.png,.jpg,.jpeg,.jfif,.webp,.avif,.gif,.bmp,.tif,.tiff,.heic,.heif";
export const RASTER_FORMATS = "PNG, JPG, WEBP, AVIF, GIF, BMP, TIFF, HEIC";

/** The queued item being previewed/edited (the first one until another is picked). */
export function useSelection(queue: Queue): [QueueItem | undefined, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  return [queue.items.find((it) => it.id === id) ?? queue.items[0], setId];
}

const NATIVE = /^image\/(png|jpe?g|webp|avif|gif|bmp)$/;

function Thumb({ file }: { file: File }) {
  const url = useObjectUrl(NATIVE.test(file.type) ? file : null);
  return url ? (
    <img src={url} alt="" decoding="async" className="size-full object-cover" />
  ) : (
    <span className="flex flex-col items-center gap-0.5 text-muted">
      <FileIcon className="size-4" />
      <span className="font-mono text-[9px] uppercase">{splitName(file.name).ext}</span>
    </span>
  );
}

/** Thumbnail strip to pick which queued image is shown (only with 2+ images). */
export function ItemPicker({
  items,
  selected,
  onSelect,
  marked,
}: {
  items: QueueItem[];
  selected?: string;
  onSelect: (id: string) => void;
  /** Items to flag with a dot (e.g. individually adjusted). */
  marked?: (id: string) => boolean;
}) {
  const t = useT(s);
  if (items.length < 2) return null;
  return (
    <div role="group" aria-label={t("chooseImage")} className="flex min-w-0 gap-2 overflow-x-auto p-0.5 pb-1.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={it.id === selected}
          title={it.file.name}
          aria-label={it.file.name}
          onClick={() => onSelect(it.id)}
          className={cx(
            "checker relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 transition",
            it.id === selected ? "border-accent" : "border-line hover:border-line-strong",
          )}
        >
          <Thumb file={it.file} />
          {marked?.(it.id) ? <span className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-surface" /> : null}
        </button>
      ))}
    </div>
  );
}

export interface Preview {
  url: string;
  /** Full (EXIF-oriented) size of the source. */
  width: number;
  height: number;
}

// ponytail: previews live for the page session (keyed by File); revoke if memory ever matters.
const previews = new WeakMap<File, Promise<Preview>>();

/** Decodes any supported image once and returns a downscaled, browser-displayable copy. */
export function loadPreview(file: File, max = 1600): Promise<Preview> {
  let p = previews.get(file);
  if (!p) {
    p = (async () => {
      const img = await decodeImage(file);
      try {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * k));
        canvas.height = Math.max(1, Math.round(img.height * k));
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, "image/webp", 0.9);
        canvas.width = canvas.height = 0;
        return { url: URL.createObjectURL(blob), width: img.width, height: img.height };
      } finally {
        img.close();
      }
    })();
    p.catch(() => previews.delete(file));
    previews.set(file, p);
  }
  return p;
}

export function usePreview(file: File | undefined): { preview: Preview | null; error: string | null } {
  const [state, setState] = useState<{ file?: File; preview: Preview | null; error: string | null }>({ preview: null, error: null });
  useEffect(() => {
    if (!file) return;
    let live = true;
    loadPreview(file).then(
      (preview) => live && setState({ file, preview, error: null }),
      (e: unknown) => live && setState({ file, preview: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [file]);
  // Never show the previous file's preview for a new file.
  return state.file === file ? state : { preview: null, error: null };
}
