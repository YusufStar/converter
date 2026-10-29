import { useSyncExternalStore } from "react";

// Favourite and recently used tools, per browser. Storage can be blocked (private mode,
// previews): everything degrades to an in-memory list.

type Key = "fav" | "recent";
const STORAGE: Record<Key, string> = { fav: "converter.favorites", recent: "converter.recent" };
const RECENT_MAX = 8;

const listeners = new Set<() => void>();
const cache: Record<Key, string[]> = { fav: read("fav"), recent: read("recent") };

function read(key: Key): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE[key]) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function write(key: Key, list: string[]) {
  cache[key] = list;
  try {
    localStorage.setItem(STORAGE[key], JSON.stringify(list));
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const useFavorites = () => useSyncExternalStore(subscribe, () => cache.fav, () => cache.fav);
export const useRecent = () => useSyncExternalStore(subscribe, () => cache.recent, () => cache.recent);

export function toggleFavorite(slug: string) {
  const list = cache.fav;
  write("fav", list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);
}

export function markRecent(slug: string) {
  if (cache.recent[0] === slug) return;
  write("recent", [slug, ...cache.recent.filter((s) => s !== slug)].slice(0, RECENT_MAX));
}
