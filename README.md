# Converter

Free, private file converter that runs entirely in the browser — images, PDF, documents, video/audio, data, archives and quick unit/colour/encoding converters. No sign-up, no uploads: every file is processed on the visitor's device (Canvas, WebAssembly, pdf-lib, pdf.js, ffmpeg.wasm).

## Develop

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end tests (Playwright, reuses the dev server)
npm run build      # static site in dist/ (one HTML page per tool + sitemap.xml)
```

`SITE_URL` (default `https://converter.openwild.ai`) sets canonical URLs and the sitemap at build time.

## Structure

- `src/catalog.ts` — every tool (slug, group, engine, preset, EN/TR copy)
- `src/tools/<group>/` — tool screens per group, each lazy-loaded
- `src/lib/` — pure conversion logic (unit-tested)
- `src/ui/` — shared kit: dropzone, queue, results (one-click download, ZIP for many)
- `e2e/` — Playwright specs + fixtures

## Deploy (Coolify + Railpack)

Railpack detects the Vite SPA and serves `dist/` with Caddy.

| Setting | Value |
|---|---|
| Build pack | Railpack, site type Dynamic |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Start command | *(empty — otherwise Railpack skips the Caddy static server)* |
| Exposed port | `80` (or set `PORT` and expose that) |
| Health check | `/health` |

No server, database or secrets: the output is a static site, so any static host works too (every tool also has its own `dist/<slug>/index.html`).
