// Puts the background-removal model into public/models/ so the site serves it from its own
// origin (no third-party request at runtime). Runs before `dev` and `build`; downloads once,
// verifies the pinned SHA-256, and is a no-op when the file is already there.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const model = JSON.parse(await readFile(new URL("../src/lib/ml/model.json", import.meta.url), "utf8"));
const dir = new URL("../public/models/", import.meta.url).pathname;
const target = join(dir, model.file);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(dir, { recursive: true });
// Drop models from older pins.
for (const f of await readdir(dir)) if (f !== model.file) await rm(join(dir, f), { force: true });

if (existsSync(target) && sha256(await readFile(target)) === model.sha256) process.exit(0);

console.log(`Downloading ${model.file} (${(model.bytes / 1e6).toFixed(0)} MB)…`);
const res = await fetch(model.source);
if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status} from ${model.source}`);
const bytes = new Uint8Array(await res.arrayBuffer());
const got = sha256(bytes);
if (got !== model.sha256) throw new Error(`Model checksum mismatch: expected ${model.sha256}, got ${got}`);
await writeFile(`${target}.part`, bytes);
await rename(`${target}.part`, target);
console.log(`Saved public/models/${model.file}`);
