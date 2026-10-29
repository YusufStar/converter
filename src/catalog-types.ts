// Pure data types shared by every tool catalog. No runtime imports here:
// vite.config.ts loads the catalogs in Node to write one HTML page per tool.

import type { Lang } from "./lib/langs";

export type GroupId = "image" | "pdf" | "document" | "media" | "data" | "archive" | "font" | "utility";

/** Copy in every UI language (see src/lib/langs.ts). */
export type L10n = Record<Lang, string>;

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
  /**
   * Input file extensions the tool accepts (lowercase, no dot), used to offer
   * "open in another tool" and to route files dropped on the home page.
   * Engines with fixed inputs get a default in src/inputs.ts.
   */
  input?: string[];
  /**
   * Slug of the main tool this page is a preset of (e.g. png-to-jpg → jpg-converter).
   * Such pages stay out of the sidebar and home grid but are searchable, in the
   * sitemap, and linked from their parent's page.
   */
  parent?: string;
}
