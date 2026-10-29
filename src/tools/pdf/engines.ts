import { lazyEngine } from "../../lib/lazy-engine";
import { Combine, FileImage, FileMinus, FileOutput, FileText, Hash, ImageDown, Images, LayoutGrid, RotateCw, Scissors, Shrink, Stamp, Tags } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "pdf-merge": lazyEngine(() => import("./merge-tool")),
  "pdf-split": lazyEngine(() => import("./split-tool")),
  "pdf-organize": lazyEngine(() => import("./organize-tool")),
  "pdf-pages": lazyEngine(() => import("./pages-tool")),
  "pdf-images": lazyEngine(() => import("./images-tool")),
  "pdf-compress": lazyEngine(() => import("./compress-tool")),
  "pdf-numbers": lazyEngine(() => import("./numbers-tool")),
  "pdf-watermark": lazyEngine(() => import("./watermark-tool")),
  "pdf-text": lazyEngine(() => import("./text-tool")),
  "pdf-metadata": lazyEngine(() => import("./metadata-tool")),
};

export const icons: IconMap = {
  "merge-pdf": Combine,
  "split-pdf": Scissors,
  "extract-pdf-pages": FileOutput,
  "organize-pdf": LayoutGrid,
  "rotate-pdf": RotateCw,
  "remove-pdf-pages": FileMinus,
  "pdf-to-jpg": FileImage,
  "pdf-to-png": Images,
  "pdf-to-webp": ImageDown,
  "compress-pdf": Shrink,
  "pdf-page-numbers": Hash,
  "pdf-watermark": Stamp,
  "pdf-to-text": FileText,
  "pdf-metadata": Tags,
};
