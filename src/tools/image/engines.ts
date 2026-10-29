import { lazyEngine } from "../../lib/lazy-engine";
import { Aperture, Crop, FileImage, Film, Image, ImageDown, ImagePlus, Images, Layers, RotateCw, Shapes, Smartphone, Sparkles, Star } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  image: lazyEngine(() => import("./image-tool")),
  "image-pdf": lazyEngine(() => import("./images-to-pdf-tool")),
  "image-gif": lazyEngine(() => import("./gif-maker-tool")),
  "image-favicon": lazyEngine(() => import("./favicon-tool")),
};

export const icons: IconMap = {
  "image-converter": Images,
  "webp-converter": ImagePlus,
  "png-converter": Image,
  "jpg-converter": FileImage,
  "avif-converter": ImagePlus,
  "jxl-converter": Sparkles,
  "psd-converter": Layers,
  "raw-converter": Aperture,
  "svg-converter": Shapes,
  "heic-converter": Smartphone,
  "gif-converter": Film,
  "image-resizer": Crop,
  "image-compressor": ImageDown,
  "image-rotate": RotateCw,
  "favicon-generator": Star,
  "gif-maker": Film,
  "images-to-pdf": Images,
};
