import { splitName } from "./files";

// Files travelling from one page to another: "continue with another tool", files dropped on the
// home page, and files the OS opens with the installed app. Held in memory only.

let pending: { slug: string; files: File[] } | null = null;

export function handOff(slug: string, files: File[]) {
  pending = { slug, files };
}

/** Takes (and clears) the files waiting for `slug`. */
export function takeHandoff(slug: string): File[] {
  if (!pending || pending.slug !== slug) return [];
  const { files } = pending;
  pending = null;
  return files;
}

/** Lowercase extensions of the given files, without duplicates. */
export function extensionsOf(files: { name: string }[]): string[] {
  return [...new Set(files.map((f) => splitName(f.name).ext).filter(Boolean))];
}
