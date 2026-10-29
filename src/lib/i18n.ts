import { DEFAULT_LANG, LANGS, isLang, type Lang } from "./langs";
import { localize, navigate, splitPath, usePath } from "./router";

export { LANGS, type Lang };

// The URL decides the language (/tr/… is Turkish, the root is English) so every page is
// indexable per language. A saved choice, or else the browser language, only picks where a
// visitor without a language in the URL lands.

const KEY = "converter.lang";

function savedLang(): Lang | null {
  try {
    const saved = localStorage.getItem(KEY) ?? undefined;
    return isLang(saved) ? saved : null;
  } catch {
    return null; // storage blocked
  }
}

function browserLang(): Lang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag?.toLowerCase().split("-")[0];
    if (isLang(code)) return code;
  }
  return DEFAULT_LANG;
}

if (typeof window !== "undefined") {
  const { lang } = splitPath(location.pathname);
  const wanted = savedLang() ?? browserLang();
  if (lang === DEFAULT_LANG && wanted !== DEFAULT_LANG) {
    history.replaceState(null, "", localize(location.pathname, wanted) + location.search + location.hash);
  }
  document.documentElement.lang = splitPath(location.pathname).lang;
}

export function getLang(): Lang {
  return typeof location === "undefined" ? DEFAULT_LANG : splitPath(location.pathname).lang;
}

/** Switches language: remembers the choice and moves to the same page in that language. */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // ignore
  }
  navigate(location.pathname, { lang });
}

export function useLang(): Lang {
  return splitPath(usePath()).lang;
}

export type Vars = Record<string, string | number>;

/** Languages beyond English and Turkish, passed to defineDict as one object. */
export type MoreLangs = "es" | "de" | "fr" | "pt";

/**
 * A translation table: English is the source; every other language has the same keys.
 * `defineDict(en, tr, { es, de, fr, pt })`.
 */
export function defineDict<const E extends Record<string, string>>(
  en: E,
  tr: Record<keyof E, string>,
  more: Record<MoreLangs, Record<keyof E, string>>,
) {
  return { en, tr, ...more };
}

export function format(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** `const t = useT(dict); t("key", { n: 3 })` — re-renders when the language changes. */
export function useT<E extends Record<string, string>>(dict: { en: E } & Partial<Record<string, Record<keyof E, string>>>) {
  const lang = useLang();
  return (key: keyof E & string, vars?: Vars) => format(dict[lang]?.[key] ?? dict.en[key], vars);
}
