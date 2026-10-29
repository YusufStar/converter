# Converter

Free, private file converter that runs entirely in the browser: images (incl. HEIC, RAW, PSD, JPEG XL), PDF (merge, split, sign, forms, protect/unlock, OCR), documents, video and audio, data, archives (ZIP, RAR, 7z), fonts, QR/barcodes and quick converters. No sign-up, no uploads: every file is processed on the visitor's device with Canvas, Web Workers and WebAssembly.

## Develop

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end tests (Playwright, starts or reuses the dev server)
npm run build      # static site in dist/
PW_PREVIEW=1 npm run test:e2e   # e2e against the production build (after npm run build)
```

Build-time environment:

| Variable | Default | Purpose |
|---|---|---|
| `SITE_URL` | `https://converter.openwild.ai` | canonical URLs and the sitemap |
| `ANALYTICS_SRC` | *(unset)* | optional analytics script URL (e.g. Plausible); nothing external loads when unset |
| `ANALYTICS_ATTRS` | *(unset)* | attributes for that script, e.g. `data-domain=converter.openwild.ai` |

## How it fits together

- `src/catalog.ts` lists every page. Each tool area has `src/tools/<area>/catalog.ts` (pure data: slug, group, engine, preset, accepted `input` extensions, copy in six languages) and `engines.ts` (lazy-loaded screens). Pages with a `parent` are presets of another tool ("PNG to JPG"): they stay out of the sidebar, show up in search and are linked from their parent.
- `src/lib/` holds the conversion logic (unit-tested); heavy work runs in Web Worker pools sized to the CPU (images, SVG tracing, hashing, QR, fonts, qpdf, OCR, ONNX).
- `src/ui/` is the shared kit: drop zone (files, folders, paste), queue, results (one-click download, ZIP for many, "continue with another tool").
- Languages: English at `/`, Turkish, Spanish, German, French and Portuguese under `/tr/`, `/es/`, `/de/`, `/fr/`, `/pt/`. UI copy is `defineDict(en, tr, { es, de, fr, pt })`; `src/lib/translations.test.ts` fails when anything is missing. Only English pages are indexed: translated pages carry `noindex` and the sitemap lists English URLs only.
- `build/site.ts` writes one HTML page per tool and language (title, description, engine-chunk preloads), `sitemap.xml`, `robots.txt`, `manifest.webmanifest` (installable app, OS "Open with" file handlers) and `sw.js` (offline: app shell precached, engines cached on first use).
- The app is cross-origin isolated (`COOP: same-origin`, `COEP: credentialless`) so multi-threaded WebAssembly works (ffmpeg, ONNX, LibRaw). Browsers without it fall back to single-threaded builds.
- Big runtime assets are served from our own origin, never from third parties at runtime: the ISNet background-removal model (Apache-2.0, ~88 MB) and the 16 Tesseract OCR language files (~34 MB). `scripts/fetch-assets.mjs` runs before `dev` and `build`, downloads each pinned file once (SHA-256 checked, see `src/lib/ml/model.json` and `src/lib/ml/tessdata.json`) into `public/models/` and `public/tessdata/` (git-ignored). Browsers cache them after first use. User files never leave the device.

## Deploy (Coolify + Railpack)

Railpack detects the Vite SPA and serves `dist/` with Caddy. The repo's `Caddyfile` replaces Railpack's default one (same port and `/health`, plus the isolation headers and long-lived caching for `/assets`).

| Setting | Value |
|---|---|
| Build pack | Railpack |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Start command | *(empty, otherwise Railpack skips the Caddy static server)* |
| Exposed port | `80` (or set `PORT` and expose that) |
| Health check | `/health` |

No server, database or secrets. Any static host works if it sends the two isolation headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`); without them video and RAW decoding still work, just single-threaded.
