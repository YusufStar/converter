/// <reference types="vitest/config" />
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TOOLS } from "./src/catalog";

const SITE_URL = (process.env.SITE_URL ?? "https://converter.openwild.ai").replace(/\/$/, "");

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Writes dist/<slug>/index.html for every tool (own title, description and
 * canonical), plus sitemap.xml and robots.txt. Any static host can then serve
 * deep links without rewrite rules, and crawlers see per-tool metadata.
 */
function toolPages(): Plugin {
  let outDir = "dist";
  return {
    name: "tool-pages",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    async closeBundle() {
      const html = await readFile(join(outDir, "index.html"), "utf8");
      for (const tool of TOOLS) {
        const page = html
          .replace(/<title>.*?<\/title>/s, `<title>${escape(tool.name.en)} — Converter</title>`)
          .replace(/<meta name="description" content=".*?" \/>/s, `<meta name="description" content="${escape(tool.desc.en)}" />`)
          .replace("</head>", `  <link rel="canonical" href="${SITE_URL}/${tool.slug}" />\n  </head>`);
        await mkdir(join(outDir, tool.slug), { recursive: true });
        await writeFile(join(outDir, tool.slug, "index.html"), page);
      }
      const urls = ["", ...TOOLS.map((t) => t.slug)].map((s) => `  <url><loc>${SITE_URL}/${s}</loc></url>`).join("\n");
      await writeFile(
        join(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      );
      await writeFile(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), toolPages()],
  // ffmpeg + squoosh codecs spawn workers / load wasm relative to their own files.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@jsquash/webp", "@jsquash/avif"] },
  worker: { format: "es" },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
