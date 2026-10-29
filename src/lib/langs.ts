// Supported UI languages. English lives at the site root; every other language under /<code>/.
export const LANGS = ["en", "tr", "es", "de", "fr", "pt"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";

/** Each language's own name, as shown in the language menu. */
export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  tr: "Türkçe",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  pt: "Português",
};

/** BCP 47 locale for dates/numbers in each UI language. */
const LOCALES: Record<string, string> = { en: "en-US", tr: "tr-TR", es: "es-ES", de: "de-DE", fr: "fr-FR", pt: "pt-BR" };
export const localeOf = (lang: string): string => LOCALES[lang] ?? "en-US";

export const isLang = (s: string | undefined): s is Lang => !!s && (LANGS as readonly string[]).includes(s);
