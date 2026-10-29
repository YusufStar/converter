import type { GroupId, L10n, ToolMeta } from "./catalog-types";
import { imageTools } from "./tools/image/catalog";
import { pdfTools } from "./tools/pdf/catalog";
import { documentTools } from "./tools/document/catalog";
import { mediaTools } from "./tools/media/catalog";
import { dataTools } from "./tools/data/catalog";
import { archiveTools } from "./tools/archive/catalog";
import { utilityTools } from "./tools/utility/catalog";

export type { GroupId, L10n, ToolMeta };

export const GROUPS: { id: GroupId; name: L10n }[] = [
  { id: "image", name: { en: "Image", tr: "Görsel" } },
  { id: "pdf", name: { en: "PDF", tr: "PDF" } },
  { id: "document", name: { en: "Documents", tr: "Belgeler" } },
  { id: "media", name: { en: "Video & Audio", tr: "Video ve Ses" } },
  { id: "data", name: { en: "Data & Spreadsheets", tr: "Veri ve Tablolar" } },
  { id: "archive", name: { en: "Archives", tr: "Arşivler" } },
  { id: "utility", name: { en: "Quick converters", tr: "Hızlı çeviriciler" } },
];

export const TOOLS: ToolMeta[] = [
  ...imageTools,
  ...pdfTools,
  ...documentTools,
  ...mediaTools,
  ...dataTools,
  ...archiveTools,
  ...utilityTools,
];

export const toolBySlug = new Map(TOOLS.map((t) => [t.slug, t]));

/** Case/diacritic-insensitive search over names, descriptions, keywords and formats in both languages. */
export function searchTools(query: string, tools: ToolMeta[] = TOOLS): ToolMeta[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return tools;
  return tools.filter((t) => {
    const hay = normalize(
      [t.name.en, t.name.tr, t.desc.en, t.desc.tr, t.keywords ?? "", (t.formats ?? []).join(" "), t.slug].join(" "),
    );
    return words.every((w) => hay.includes(w));
  });
}

export function normalize(s: string): string {
  return s
    .toLocaleLowerCase("en")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
