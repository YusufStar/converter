import { lazy } from "react";
import { Binary, CaseSensitive, Clock3, FileCode2, ImageUp, Landmark, Link2, Palette, Percent, Ruler, WholeWord } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "util-units": lazy(() => import("./unit-tool")),
  "util-color": lazy(() => import("./color-tool")),
  "util-encoding": lazy(() => import("./encoding-tool")),
  "util-base": lazy(() => import("./number-base-tool")),
  "util-timestamp": lazy(() => import("./timestamp-tool")),
  "util-case": lazy(() => import("./text-case-tool")),
  "util-roman": lazy(() => import("./roman-tool")),
  "util-words": lazy(() => import("./number-words-tool")),
  "util-percent": lazy(() => import("./percent-tool")),
};

export const icons: IconMap = {
  "unit-converter": Ruler,
  "color-converter": Palette,
  "base64-converter": FileCode2,
  "image-to-base64": ImageUp,
  "url-encoder": Link2,
  "number-base-converter": Binary,
  "timestamp-converter": Clock3,
  "text-case-converter": CaseSensitive,
  "roman-numeral-converter": Landmark,
  "number-to-words": WholeWord,
  "percentage-calculator": Percent,
};
