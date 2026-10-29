/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { site } from "./build/site";

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [react(), tailwindcss(), site()],
  // ffmpeg + squoosh codecs spawn workers / load wasm relative to their own files.
  optimizeDeps: {
    exclude: [
      "@ffmpeg/ffmpeg",
      "@ffmpeg/util",
      "@jsquash/webp",
      "@jsquash/avif",
      "@jsquash/jxl",
      "onnxruntime-web",
      "libarchive.js",
      "libraw-wasm",
      "@neslinesli93/qpdf-wasm",
      "zxing-wasm",
    ],
    // Lazily imported libraries: pre-bundle them so first use in dev doesn't trigger a reload.
    include: [
      "xlsx",
      "yaml",
      "smol-toml",
      "fflate",
      "pdf-lib",
      "@pdf-lib/fontkit",
      "pdfjs-dist",
      "mammoth",
      "marked",
      "turndown",
      "gifenc",
      "upng-js",
      "utif",
      "heic-to",
      "exifr",
      "ag-psd",
      "imagetracerjs",
      "hash-wasm",
      "fonteditor-core",
      "tesseract.js",
    ],
  },
  worker: { format: "es" },
  // Parallel dev servers (e.g. several Playwright runs) each get their own optimizer cache.
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  // Cross-origin isolation enables SharedArrayBuffer (multi-threaded ffmpeg). `credentialless`
  // keeps cross-origin images/scripts loading without CORP headers; browsers that don't know it
  // simply stay non-isolated and fall back to single-threaded code. Mirrored in Caddyfile.
  server: { port: 5180, strictPort: true, headers: ISOLATION_HEADERS },
  preview: { port: 5181, strictPort: true, headers: ISOLATION_HEADERS },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
