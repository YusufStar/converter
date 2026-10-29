// Pure data types shared by every tool catalog. No runtime imports here:
// vite.config.ts loads the catalogs in Node to write one HTML page per tool.

export type GroupId = "image" | "pdf" | "document" | "media" | "data" | "archive" | "utility";

export interface L10n {
  en: string;
  tr: string;
}

export interface ToolMeta {
  /** URL path segment, e.g. "webp-converter" → /webp-converter */
  slug: string;
  /** Sidebar group the tool is listed under. */
  group: GroupId;
  /** Key of the engine component that renders the tool (see src/engines.ts). */
  engine: string;
  /** Engine-specific defaults, e.g. { format: "webp" }. */
  preset?: Record<string, unknown>;
  name: L10n;
  desc: L10n;
  /** Extra search terms (any language), space separated. */
  keywords?: string;
  /** Format chips shown on cards, e.g. ["PNG", "WEBP"]. */
  formats?: string[];
  /** Highlighted on the home page. */
  popular?: boolean;
}
