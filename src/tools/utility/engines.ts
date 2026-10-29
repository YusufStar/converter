import { lazyEngine } from "../../lib/lazy-engine";
import { Binary, CaseSensitive, Clock3, FileCode2, ImageUp, Landmark, Link2, Palette, Percent, Ruler, WholeWord } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "util-units": lazyEngine(() => import("./unit-tool")),
  "util-color": lazyEngine(() => import("./color-tool")),
  "util-encoding": lazyEngine(() => import("./encoding-tool")),
  "util-base": lazyEngine(() => import("./number-base-tool")),
  "util-timestamp": lazyEngine(() => import("./timestamp-tool")),
  "util-case": lazyEngine(() => import("./text-case-tool")),
  "util-roman": lazyEngine(() => import("./roman-tool")),
  "util-words": lazyEngine(() => import("./number-words-tool")),
  "util-percent": lazyEngine(() => import("./percent-tool")),
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
