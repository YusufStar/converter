import { lazy } from "react";
import { Combine, FileImage, FileMinus, FileOutput, FileText, Hash, ImageDown, Images, LayoutGrid, RotateCw, Scissors, Shrink, Stamp, Tags } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "pdf-merge": lazy(() => import("./merge-tool")),
  "pdf-split": lazy(() => import("./split-tool")),
  "pdf-organize": lazy(() => import("./organize-tool")),
  "pdf-pages": lazy(() => import("./pages-tool")),
  "pdf-images": lazy(() => import("./images-tool")),
  "pdf-compress": lazy(() => import("./compress-tool")),
  "pdf-numbers": lazy(() => import("./numbers-tool")),
  "pdf-watermark": lazy(() => import("./watermark-tool")),
  "pdf-text": lazy(() => import("./text-tool")),
  "pdf-metadata": lazy(() => import("./metadata-tool")),
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
