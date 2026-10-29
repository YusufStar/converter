import { useSyncExternalStore } from "react";
import { DEFAULT_LANG, isLang, type Lang } from "./langs";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") window.addEventListener("popstate", notify);

/** "/tr/merge-pdf" → { lang: "tr", rest: "/merge-pdf" }; "/merge-pdf" → { lang: "en", rest: "/merge-pdf" }. */
export function splitPath(path: string): { lang: Lang; rest: string } {
  const first = path.split("/")[1];
  if (first !== DEFAULT_LANG && isLang(first)) return { lang: first, rest: path.slice(first.length + 1) || "/" };
  return { lang: DEFAULT_LANG, rest: path || "/" };
}

/** Adds the language prefix to an app path: ("/merge-pdf", "tr") → "/tr/merge-pdf". */
export function localize(path: string, lang: Lang): string {
  const rest = splitPath(path).rest;
  if (lang === DEFAULT_LANG) return rest;
  return rest === "/" ? `/${lang}` : `/${lang}${rest}`;
}

/** Goes to an app path ("/merge-pdf") in the current language, or in `lang` when given. */
export function navigate(to: string, { replace = false, lang }: { replace?: boolean; lang?: Lang } = {}) {
  const target = localize(to, lang ?? splitPath(location.pathname).lang);
  if (target === location.pathname) return;
  if (replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  notify();
  window.scrollTo({ top: 0 });
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
    () => "/",
  );
}

/** Slug of the current tool page, or "" on the home page (language prefix ignored). */
export function slugFromPath(path: string): string {
  return splitPath(path).rest.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
}
