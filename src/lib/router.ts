import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") window.addEventListener("popstate", notify);

export function navigate(to: string) {
  if (to === location.pathname) return;
  history.pushState(null, "", to);
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

/** Slug of the current tool page, or "" on the home page. */
export function slugFromPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
}
