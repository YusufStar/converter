import type { GroupId, L10n, ToolMeta } from "./catalog-types";
import { imageTools } from "./tools/image/catalog";
import { pdfTools } from "./tools/pdf/catalog";
import { documentTools } from "./tools/document/catalog";
import { mediaTools } from "./tools/media/catalog";
import { dataTools } from "./tools/data/catalog";
import { archiveTools } from "./tools/archive/catalog";
import { utilityTools } from "./tools/utility/catalog";
import { tools as imageExtraTools } from "./tools/image-extra/catalog";
import { tools as pdfExtraTools } from "./tools/pdf-extra/catalog";
import { tools as mlTools } from "./tools/ml/catalog";
import { tools as mediaExtraTools } from "./tools/media-extra/catalog";
import { tools as devTools } from "./tools/dev/catalog";
import { tools as fontTools } from "./tools/font/catalog";
import { tools as pairTools } from "./tools/pairs/catalog";

export type { GroupId, L10n, ToolMeta };

export const GROUPS: { id: GroupId; name: L10n }[] = [
  { id: "image", name: { en: "Image", tr: "Görsel", es: "Imagen", de: "Bild", fr: "Image", pt: "Imagem" } },
  { id: "pdf", name: { en: "PDF", tr: "PDF", es: "PDF", de: "PDF", fr: "PDF", pt: "PDF" } },
  { id: "document", name: { en: "Documents", tr: "Belgeler", es: "Documentos", de: "Dokumente", fr: "Documents", pt: "Documentos" } },
  { id: "media", name: { en: "Video & Audio", tr: "Video ve Ses", es: "Vídeo y audio", de: "Video & Audio", fr: "Vidéo et audio", pt: "Vídeo e áudio" } },
  { id: "data", name: { en: "Data & Spreadsheets", tr: "Veri ve Tablolar", es: "Datos y hojas de cálculo", de: "Daten & Tabellen", fr: "Données et tableurs", pt: "Dados e planilhas" } },
  { id: "archive", name: { en: "Archives", tr: "Arşivler", es: "Archivos comprimidos", de: "Archive", fr: "Archives", pt: "Arquivos compactados" } },
  { id: "font", name: { en: "Fonts", tr: "Fontlar", es: "Fuentes", de: "Schriftarten", fr: "Polices", pt: "Fontes" } },
  { id: "utility", name: { en: "Quick converters", tr: "Hızlı çeviriciler", es: "Convertidores rápidos", de: "Schnellkonverter", fr: "Convertisseurs rapides", pt: "Conversores rápidos" } },
];

export const TOOLS: ToolMeta[] = [
  ...imageTools,
  ...imageExtraTools,
  ...pdfTools,
  ...pdfExtraTools,
  ...mlTools,
  ...documentTools,
  ...mediaTools,
  ...mediaExtraTools,
  ...dataTools,
  ...archiveTools,
  ...fontTools,
  ...utilityTools,
  ...devTools,
  ...pairTools,
];

export const toolBySlug = new Map(TOOLS.map((t) => [t.slug, t]));

/** Main tools (not "X to Y" preset pages) that accept every one of these extensions, popular first. */
export function toolsAccepting(exts: string[]): ToolMeta[] {
  if (!exts.length) return [];
  const list = TOOLS.filter((t) => !t.parent && t.input && exts.every((e) => t.input!.includes(e)));
  return [...list.filter((t) => t.popular), ...list.filter((t) => !t.popular)];
}

/** The preset pages around a tool: its children, or its parent and siblings. */
export function relatedTools(tool: ToolMeta): ToolMeta[] {
  if (tool.parent) {
    const parent = toolBySlug.get(tool.parent);
    return [...(parent ? [parent] : []), ...TOOLS.filter((t) => t.parent === tool.parent && t.slug !== tool.slug)];
  }
  return TOOLS.filter((t) => t.parent === tool.slug);
}

/** Case/diacritic-insensitive search over names, descriptions, keywords and formats in every language. */
export function searchTools(query: string, tools: ToolMeta[] = TOOLS): ToolMeta[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return tools;
  return tools.filter((t) => {
    const hay = normalize(
      [...Object.values(t.name), ...Object.values(t.desc), t.keywords ?? "", (t.formats ?? []).join(" "), t.slug].join(" "),
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
