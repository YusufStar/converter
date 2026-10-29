import { useSyncExternalStore } from "react";

export type Lang = "en" | "tr";

const KEY = "converter.lang";
const listeners = new Set<() => void>();

function initialLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "tr") return saved;
  } catch {
    // storage blocked: fall through to the browser language
  }
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

let current: Lang = initialLang();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // ignore
  }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => "en",
  );
}

export type Vars = Record<string, string | number>;

/** A translation table: English is the source, Turkish must have the same keys. */
export function defineDict<const E extends Record<string, string>>(en: E, tr: Record<keyof E, string>) {
  return { en, tr };
}

export function format(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** `const t = useT(dict); t("key", { n: 3 })` — re-renders when the language changes. */
export function useT<E extends Record<string, string>>(dict: { en: E; tr: Record<keyof E, string> }) {
  const lang = useLang();
  return (key: keyof E & string, vars?: Vars) => format(dict[lang][key] ?? dict.en[key], vars);
}
