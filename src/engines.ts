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

export interface EngineProps {
  meta: ToolMeta;
}

export type EngineMap = Record<string, LazyExoticComponent<ComponentType<EngineProps>>>;
export type IconMap = Record<string, LucideIcon>;

const groups = [image, pdf, document, media, data, archive, utility];

/** engine key → lazily loaded component (each group's code is its own chunk). */
export const ENGINES: EngineMap = Object.assign({}, ...groups.map((g) => g.engines));

/** tool slug → icon */
export const ICONS: IconMap = Object.assign({}, ...groups.map((g) => g.icons));
