// zxing-wasm barcode writer, loaded on demand with its wasm served from our own origin.

import wasmUrl from "zxing-wasm/writer/zxing_writer.wasm?url";

type Writer = typeof import("zxing-wasm/writer");
export type WriterOptions = NonNullable<Parameters<Writer["writeBarcode"]>[1]>;

let writer: Promise<Writer> | null = null;

/** Memoised: call on mount to warm up, then again for every write. */
export function loadWriter(): Promise<Writer> {
  writer ??= import("zxing-wasm/writer")
    .then(async (m) => {
      await m.prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
        fireImmediately: true,
      });
      return m;
    })
    .catch((e) => {
      writer = null;
      throw e;
    });
  return writer;
}

export async function writeSymbol(text: string, options: WriterOptions) {
  const m = await loadWriter();
  return m.writeBarcode(text, options);
}
