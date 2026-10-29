// Public model / language data, fetched once at first use with byte progress.
// Works on the main thread and inside workers (fetch + Cache Storage only).

export type OnBytes = (loaded: number, total: number) => void;

/** Fetches `url` into memory, reporting bytes as they arrive. `expected` stands in when the server sends no length. */
export async function download(url: string, onBytes?: OnBytes, expected = 0): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Couldn't download the data this tool needs — check your connection and try again");
  }
  if (!res.ok || !res.body) throw new Error(`Couldn't download the data this tool needs (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || expected;
  const reader = res.body.getReader();
  // Filled in place when the size is known, so a 100 MB model never sits in memory twice.
  let buf = new Uint8Array(total || 1 << 20);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > buf.length) {
      const grown = new Uint8Array(Math.max(buf.length * 2, loaded + value.length));
      grown.set(buf.subarray(0, loaded));
      buf = grown;
    }
    buf.set(value, loaded);
    loaded += value.length;
    onBytes?.(loaded, Math.max(total, loaded));
  }
  return loaded === buf.length ? buf : buf.slice(0, loaded);
}

/** Inflates gzip data with the browser's native DecompressionStream; anything else is returned as is. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CACHE = "converter-models-v1";
// Cache Storage needs a secure context; without it every visit downloads again.
const openCache = () => (typeof caches === "undefined" ? Promise.resolve(null) : caches.open(CACHE).catch(() => null));

export async function isCached(url: string): Promise<boolean> {
  return Boolean(await (await openCache())?.match(url));
}

/** `download`, but kept in Cache Storage so the next visit (or tab) starts instantly. */
export async function cachedDownload(url: string, onBytes?: OnBytes, expected = 0): Promise<Uint8Array> {
  const cache = await openCache();
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const bytes = await download(url, onBytes, expected);
  // ponytail: a full quota just means no cache; the download itself still worked.
  await cache?.put(url, new Response(bytes as BlobPart, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

/** A tiny observable value for engine status (download progress, ready…) shared by every screen. */
export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      subs.forEach((fn) => fn());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

export type Store<T> = ReturnType<typeof createStore<T>>;
