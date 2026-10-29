import type { ComponentType, LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";
import type { ToolMeta } from "./catalog-types";
import * as image from "./tools/image/engines";
import * as pdf from "./tools/pdf/engines";
import * as document from "./tools/document/engines";
import * as media from "./tools/media/engines";
import * as data from "./tools/data/engines";
import * as archive from "./tools/archive/engines";
import * as utility from "./tools/utility/engines";
import * as imageExtra from "./tools/image-extra/engines";
import * as pdfExtra from "./tools/pdf-extra/engines";
import * as ml from "./tools/ml/engines";
import * as mediaExtra from "./tools/media-extra/engines";
import * as dev from "./tools/dev/engines";
import * as font from "./tools/font/engines";

export interface EngineProps {
  meta: ToolMeta;
}

export type Engine = LazyExoticComponent<ComponentType<EngineProps>> & { preload?: () => Promise<unknown> };
export type EngineMap = Record<string, Engine>;
export type IconMap = Record<string, LucideIcon>;

const groups = [image, pdf, document, media, data, archive, utility, imageExtra, pdfExtra, ml, mediaExtra, dev, font];

/** engine key → lazily loaded component (each group's code is its own chunk). */
export const ENGINES: EngineMap = Object.assign({}, ...groups.map((g) => g.engines));

/** Starts downloading an engine's code (no-op for engines declared with plain `lazy`). */
export function preloadEngine(key: string) {
  void ENGINES[key]?.preload?.().catch(() => {});
}

/** tool slug → icon */
export const ICONS: IconMap = Object.assign({}, ...groups.map((g) => g.icons));
