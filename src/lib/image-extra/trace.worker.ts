// Traces one image per message off the main thread (imagetracer is CPU-heavy).
import ImageTracer from "imagetracerjs";
import { traceImage, type TraceJob } from "./trace";

self.onmessage = (e: MessageEvent<TraceJob>) => {
  try {
    self.postMessage({ ok: true, ...traceImage(ImageTracer, e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
