import { Crop, FileSearch, ImageOff, Spline } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";
import { lazyEngine } from "../../lib/lazy-engine";

export const engines: EngineMap = {
  "image-crop": lazyEngine(() => import("./crop-tool")),
  "image-exif-viewer": lazyEngine(() => import("./exif-viewer-tool")),
  "image-remove-exif": lazyEngine(() => import("./remove-exif-tool")),
  "image-svg-trace": lazyEngine(() => import("./svg-tool")),
};

export const icons: IconMap = {
  "crop-image": Crop,
  "exif-viewer": FileSearch,
  "remove-exif": ImageOff,
  "image-to-svg": Spline,
};
