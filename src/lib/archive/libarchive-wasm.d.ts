// libarchive.js ships its emscripten glue untyped; we drive it through libarchive-core.ts.
declare module "libarchive.js/src/webworker/wasm-gen/libarchive.js" {
  const factory: (opts?: object) => Promise<{ HEAPU8: Uint8Array; cwrap(name: string, ret: string | null, args: string[]): (...args: unknown[]) => unknown }>;
  export default factory;
}
