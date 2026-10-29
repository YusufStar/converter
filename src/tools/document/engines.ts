import { lazy } from "react";
import { CodeXml, FileCode, FileDown, FileText, FileType, Globe, Hash, Heading, LetterText, Pilcrow, ScrollText, TextQuote } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "doc-convert": lazy(() => import("./document-tool")),
};

export const icons: IconMap = {
  "word-to-pdf": FileText,
  "word-to-html": FileCode,
  "word-to-text": LetterText,
  "word-to-markdown": Hash,
  "markdown-to-pdf": FileDown,
  "markdown-to-html": CodeXml,
  "markdown-to-text": Pilcrow,
  "html-to-pdf": FileType,
  "html-to-markdown": Heading,
  "html-to-text": TextQuote,
  "text-to-pdf": ScrollText,
  "text-to-html": Globe,
};
