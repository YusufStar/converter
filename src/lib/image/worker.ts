// Image worker: runs ./jobs.ts (decode → resize/rotate/flip/background → encode) on an
// OffscreenCanvas, off the main thread. Spawned and fed by ./pool.ts.
import { fromBitmap, NeedsDom, type Decoded } from "./decode";
import { warmCodecs } from "./encode";
import { jobs, type Jobs } from "./jobs";

export type Request = { warm: string[] } | { id: number; job: keyof Jobs; file: File; args: unknown[]; pre?: ImageBitmap };

const scope = self as unknown as { onmessage: (e: MessageEvent<Request>) => void; postMessage(m: unknown, transfer?: Transferable[]): void };

/** ArrayBuffers of typed-array fields in a result: moved, not copied. */
const transferables = (v: unknown): Transferable[] =>
  v && typeof v === "object" ? Object.values(v).flatMap((x) => (ArrayBuffer.isView(x) && x.buffer instanceof ArrayBuffer ? [x.buffer] : [])) : [];

scope.onmessage = async ({ data }) => {
  if ("warm" in data) return void warmCodecs(data.warm);
  const { id, job, file, args, pre } = data;
  try {
    const run = jobs[job] as (file: File, pre: Decoded | undefined, ...args: unknown[]) => Promise<unknown>;
    const value = await run(file, pre && fromBitmap(pre), ...args);
    scope.postMessage({ id, ok: true, value }, transferables(value));
  } catch (e) {
    scope.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e), dom: e instanceof NeedsDom });
  }
};
