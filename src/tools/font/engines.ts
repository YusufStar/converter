import { CaseSensitive, FileType } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";
import { lazyEngine } from "../../lib/lazy-engine";
import { tools } from "./catalog";

export const engines: EngineMap = {
  "font-convert": lazyEngine(() => import("./font-tool")),
};

export const icons: IconMap = Object.fromEntries(tools.map((t) => [t.slug, t.parent ? FileType : CaseSensitive]));
