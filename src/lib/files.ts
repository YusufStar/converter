export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)} ${units[i]}`;
}

/** "photo.final.JPG" → { base: "photo.final", ext: "jpg" } */
export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

export function withExt(name: string, ext: string): string {
  return `${splitName(name).base}.${ext}`;
}

/** Makes names unique the way file managers do: a.png, a (2).png, a (3).png */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    let n = 2;
    const { base, ext } = splitName(name);
    while (seen.has(candidate.toLowerCase())) candidate = ext ? `${base} (${n++}).${ext}` : `${name} (${n++})`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Same rules as <input accept>: ".ext", "type/*" or "type/subtype"; empty accepts everything. */
export function matchesAccept(file: { name: string; type: string }, accept?: string): boolean {
  if (!accept) return true;
  const ext = `.${splitName(file.name).ext}`;
  const type = file.type.toLowerCase();
  return accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((t) => (t.startsWith(".") ? t === ext : t.endsWith("/*") ? type.startsWith(t.slice(0, -1)) : t === type));
}

let counter = 0;
export function uid(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

/** Percentage change from `before` to `after`, rounded; negative = smaller. */
export function sizeDelta(before: number, after: number): number {
  if (!before) return 0;
  return Math.round(((after - before) / before) * 100);
}
