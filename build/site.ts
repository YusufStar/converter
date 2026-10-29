import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { Plugin } from "vite";
import { TOOLS } from "../src/catalog";
import { DEFAULT_LANG, LANGS, type Lang } from "../src/lib/langs";
import { ui } from "../src/ui/strings";

const SITE_URL = (process.env.SITE_URL ?? "https://converter.openwild.ai").replace(/\/$/, "");

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// MIME types for the OS "Open with" registration (manifest file_handlers).
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", webp: "image/webp", avif: "image/avif",
  gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", ico: "image/x-icon", svg: "image/svg+xml",
  heic: "image/heic", heif: "image/heif", jxl: "image/jxl", psd: "image/vnd.adobe.photoshop",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown", markdown: "text/markdown", html: "text/html", htm: "text/html", txt: "text/plain",
  csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", xml: "application/xml",
  yaml: "application/yaml", yml: "application/yaml", toml: "application/toml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed", tar: "application/x-tar",
  gz: "application/gzip", tgz: "application/gzip",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  srt: "application/x-subrip", vtt: "text/vtt",
};
const VIDEO = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "3gp", "ts", "mts", "m2ts", "mpg", "mpeg", "ogv"]);
const AUDIO = new Set(["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "aif", "aiff", "wma", "amr"]);

function mimeOf(ext: string): string {
  if (MIME[ext]) return MIME[ext];
  if (VIDEO.has(ext)) return `video/${ext}`;
  if (AUDIO.has(ext)) return `audio/${ext}`;
  return `application/x-${ext}`;
}

function webManifest() {
  const accept: Record<string, string[]> = {};
  const exts = [...new Set(TOOLS.flatMap((t) => t.input ?? []))].sort();
  for (const ext of exts) (accept[mimeOf(ext)] ??= []).push(`.${ext}`);
  return {
    name: "Converter — every file converter in your browser",
    short_name: "Converter",
    description: "Convert images, PDFs, documents, video, audio and data on your own device. No uploads, no sign-up.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#121110",
    theme_color: "#ff6b2c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    file_handlers: [{ action: "/", accept }],
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
    categories: ["utilities", "productivity"],
  };
}

/** engine key → its component's source file, read from every src/tools/<area>/engines.ts. */
async function engineSources(root: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const toolsDir = join(root, "src/tools");
  for (const area of await readdir(toolsDir)) {
    const file = join(toolsDir, area, "engines.ts");
    if (!existsSync(file)) continue;
    const src = await readFile(file, "utf8");
    for (const m of src.matchAll(/["']?([\w-]+)["']?\s*:\s*lazy\w*\(\s*\(\)\s*=>\s*import\(\s*["'](\.[^"']+)["']\s*\)\s*\)/g)) {
      const base = posix.join("src/tools", area, m[2]);
      const found = [base, `${base}.tsx`, `${base}.ts`].find((p) => existsSync(join(root, p)));
      if (found) map.set(m[1], found);
    }
  }
  return map;
}

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/**
 * Writes .br and .gz next to every compressible file of 32 KB or more (Caddy serves them with
 * `precompressed`), so the 32 MB video engine travels as ~8 MB without compressing it again on
 * every request. Files that barely shrink (the fp16 model, .gz data) are left alone.
 */
async function precompress(dir: string) {
  const files: string[] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && /\.(m?js|css|wasm|json|svg|onnx|webmanifest)$/.test(entry.name)) files.push(path);
  }
  const queue = [...files];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        const data = await readFile(path);
        if (data.length < 32 * 1024) continue;
        const [br, gzipped] = await Promise.all([
          brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
          gz(data, { level: 9 }),
        ]);
        if (br.length < data.length * 0.9) await writeFile(`${path}.br`, br);
        if (gzipped.length < data.length * 0.9) await writeFile(`${path}.gz`, gzipped);
      }
    }),
  );
}

interface ManifestChunk {
  file: string;
  imports?: string[];
}

/**
 * Site plumbing around the SPA:
 * - dist/[<lang>/]<slug>/index.html per tool and language (own title and description; English
 *   pages get a canonical, translated ones noindex) that also modulepreloads the tool's engine
 *   chunk, so a deep link doesn't wait on "Loading engine…"; the root index.html stays English
 * - sitemap.xml lists the English pages only
 * - robots.txt, manifest.webmanifest (with OS file handlers), sw.js (offline)
 * - .br/.gz copies of the big files for Caddy's `precompressed`
 * - optional privacy-friendly analytics script from ANALYTICS_SRC (+ ANALYTICS_ATTRS)
 */
export function site(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "site",
    config(_, { command }) {
      // The build manifest maps engine sources to chunks for the per-tool preloads.
      if (command === "build") return { build: { manifest: true } };
    },
    configResolved(c) {
      outDir = c.build.outDir;
      root = c.root;
    },
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(JSON.stringify(webManifest()));
      });
    },
    transformIndexHtml(html) {
      const src = process.env.ANALYTICS_SRC;
      if (!src) return html;
      // e.g. ANALYTICS_SRC=https://plausible.io/js/script.js ANALYTICS_ATTRS="data-domain=converter.openwild.ai"
      const attrs = (process.env.ANALYTICS_ATTRS ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((kv) => {
          const [k, ...v] = kv.split("=");
          return v.length ? `${k}="${escape(v.join("="))}"` : k;
        })
        .join(" ");
      return html.replace("</head>", `  <script defer src="${escape(src)}" ${attrs}></script>\n  </head>`);
    },
    async closeBundle() {
      // Vite calls closeBundle in dev too when the server stops; only act on a real build.
      const manifestFile = join(outDir, ".vite/manifest.json");
      if (!existsSync(manifestFile)) return;
      const chunks = JSON.parse(await readFile(manifestFile, "utf8")) as Record<string, ManifestChunk>;
      await rm(join(outDir, ".vite"), { recursive: true, force: true });

      const preloads = (key: string): string[] => {
        const seen = new Set<string>();
        const walk = (k: string) => {
          const c = chunks[k];
          if (!c || seen.has(c.file)) return;
          seen.add(c.file);
          c.imports?.forEach(walk);
        };
        walk(key);
        return [...seen];
      };
      const engines = await engineSources(root);
      const html = await readFile(join(outDir, "index.html"), "utf8");
      const already = new Set([...html.matchAll(/(?:src|href)="\/([^"]+\.js)"/g)].map((m) => m[1]));

      const path = (slug: string, lang: Lang) => (lang === DEFAULT_LANG ? `/${slug}` : slug ? `/${lang}/${slug}` : `/${lang}`);
      // Only the English pages are meant for search engines: the translated copies are for
      // visitors and carry noindex (and stay out of the sitemap), so the site never presents
      // six near-identical versions of every page.
      const head = (lang: Lang, slug: string) =>
        lang === DEFAULT_LANG
          ? `  <link rel="canonical" href="${SITE_URL}${path(slug, lang)}" />\n`
          : `  <meta name="robots" content="noindex, follow" />\n`;
      const page = (lang: Lang, slug: string, title: string, description: string, extraHead = "") =>
        html
          .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
          .replace(/<title>.*?<\/title>/s, `<title>${escape(title)}</title>`)
          .replace(/<meta name="description" content=".*?" \/>/s, `<meta name="description" content="${escape(description)}" />`)
          .replace("</head>", `${head(lang, slug)}${extraHead}  </head>`);
      const write = async (lang: Lang, slug: string, content: string) => {
        const dir = join(outDir, path(slug, lang));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "index.html"), content);
      };

      for (const lang of LANGS) {
        const copy = ui[lang];
        await write(lang, "", page(lang, "", `Converter — ${copy.tagline}`, copy.heroBody));
        for (const tool of TOOLS) {
          const source = engines.get(tool.engine);
          const links = (source ? preloads(source) : [])
            .filter((f) => !already.has(f))
            .map((f) => `  <link rel="modulepreload" crossorigin href="/${f}" />\n`)
            .join("");
          await write(lang, tool.slug, page(lang, tool.slug, `${tool.name[lang]} — Converter`, tool.desc[lang], links));
        }
      }

      const urls = ["", ...TOOLS.map((t) => t.slug)].map((slug) => `  <url><loc>${SITE_URL}${path(slug, DEFAULT_LANG)}</loc></url>`).join("\n");
      await writeFile(
        join(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      );
      await writeFile(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
      await writeFile(join(outDir, "manifest.webmanifest"), JSON.stringify(webManifest(), null, 2));

      // Service worker: precache the shell (entry JS/CSS, fonts, icons); everything else in
      // /assets is cached on first use.
      const assets = (await readdir(join(outDir, "assets"))).map((f) => `/assets/${f}`).sort();
      const entry = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      const shell = [...new Set(["/", "/index.html", "/favicon.svg", "/manifest.webmanifest", "/icons/icon-192.png", ...entry, ...assets.filter((a) => a.endsWith(".woff2"))])];
      const version = createHash("sha256").update(assets.join("\n")).update(html).digest("hex").slice(0, 12);
      const sw = await readFile(join(root, "src/pwa/sw.js"), "utf8");
      await mkdir(dirname(join(outDir, "sw.js")), { recursive: true });
      await writeFile(join(outDir, "sw.js"), `const BUILD = ${JSON.stringify({ version, shell, assets })};\n${sw}`);
      await precompress(outDir);
    },
  };
}
