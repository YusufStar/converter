// Puts the big runtime assets into public/ so the site serves them from its own origin (no
// third-party request at runtime): the background-removal model (src/lib/ml/model.json) and
// the OCR language files (src/lib/ml/tessdata.json). Runs before `dev` and `build`; downloads
// only what's missing, checks every file against its pinned SHA-256, removes stale files.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const json = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const model = await json("src/lib/ml/model.json");
const tessdata = await json("src/lib/ml/tessdata.json");

/** Everything to place under public/: { dest, url, sha256, bytes }. */
const assets = [
  { dest: `models/${model.file}`, url: model.source, sha256: model.sha256, bytes: model.bytes },
  ...Object.entries(tessdata.files).map(([code, f]) => ({
    dest: `${tessdata.dir}/${code}.traineddata.gz`,
    url: tessdata.source.replaceAll("{code}", code),
    ...f,
  })),
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const publicDir = join(root, "public");

// Drop files from older pins in the managed folders.
const keep = new Set(assets.map((a) => join(publicDir, a.dest)));
for (const dir of new Set(["models", "tessdata"].map((d) => join(publicDir, d)))) {
  if (!existsSync(dir)) continue;
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && !keep.has(path)) await rm(path, { force: true });
  }
}

async function ensure({ dest, url, sha256: want, bytes }) {
  const target = join(publicDir, dest);
  if (existsSync(target) && sha256(await readFile(target)) === want) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const got = sha256(data);
  if (got !== want) throw new Error(`Checksum mismatch for ${dest}: expected ${want}, got ${got}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(`${target}.part`, data);
  await rename(`${target}.part`, target);
  console.log(`Saved public/${dest} (${(bytes / 1e6).toFixed(1)} MB)`);
  return true;
}

// A few downloads at a time.
const queue = [...assets];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await ensure(next);
  }),
);
