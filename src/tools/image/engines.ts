import { lazy } from "react";
import { Crop, FileImage, Film, Image, ImageDown, ImagePlus, Images, RotateCw, Shapes, Smartphone, Star } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  image: lazy(() => import("./image-tool")),
};

export const icons: IconMap = {
  "image-converter": Images,
  "webp-converter": ImagePlus,
  "png-converter": Image,
  "jpg-converter": FileImage,
  "avif-converter": ImagePlus,
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
