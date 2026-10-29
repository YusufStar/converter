import { Eraser, FileSearch, ScanText } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";
import { lazyEngine } from "../../lib/lazy-engine";

export const engines: EngineMap = {
  "ml-ocr": lazyEngine(() => import("./ocr-tool")),
  "ml-pdf-ocr": lazyEngine(() => import("./pdf-ocr-tool")),
  "ml-remove-bg": lazyEngine(() => import("./remove-bg-tool")),
};

export const icons: IconMap = {
  "image-to-text": ScanText,
  "pdf-ocr": FileSearch,
  "remove-background": Eraser,
};
