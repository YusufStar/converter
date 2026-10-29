import { useCallback, useRef, useState } from "react";
import { uid } from "./files";
import { mapPool } from "./pool";

export type ItemStatus = "idle" | "working" | "done" | "error";

export interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  /** 0..1 */
  progress: number;
  error?: string;
}

export interface Output {
  id: string;
  name: string;
  blob: Blob;
  /** Size of the input the output came from, for the "−42%" badge. */
  sourceSize?: number;
  width?: number;
  height?: number;
  /** Short extra line under the result, e.g. "12 pages". */
  note?: string;
}

export type OutputInit = Omit<Output, "id">;

export interface RunContext {
  /** Report progress 0..1. */
  progress(p: number): void;
  signal: AbortSignal;
}

export function errorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError") return "Cancelled";
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

/**
 * Input files + outputs + run state shared by every file tool.
 * `runEach` converts files one by one (with a small concurrency), `runAll`
 * turns the whole list into outputs at once (merge, zip, slideshow…).
 */
export function useQueue({ multiple = true }: { multiple?: boolean } = {}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, p: Partial<QueueItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const add = useCallback(
    (files: File[] | FileList) => {
      const next = Array.from(files).map<QueueItem>((file) => ({ id: uid(), file, status: "idle", progress: 0 }));
      if (!next.length) return;
      setItems((list) => (multiple ? [...list, ...next] : next.slice(0, 1)));
      setError(null);
    },
    [multiple],
  );

  const remove = useCallback((id: string) => setItems((list) => list.filter((it) => it.id !== id)), []);

  const move = useCallback((from: number, to: number) => {
    setItems((list) => {
      if (to < 0 || to >= list.length || from === to) return list;
      const copy = [...list];
      const [it] = copy.splice(from, 1);
      copy.splice(to, 0, it);
      return copy;
    });
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setItems([]);
    setOutputs([]);
    setError(null);
    setProgress(0);
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const start = () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    setProgress(0);
    setOutputs([]);
    return ctrl;
  };

  const runEach = useCallback(
    async (fn: (file: File, ctx: RunContext) => Promise<OutputInit | OutputInit[]>, concurrency = 2) => {
      const list = itemsRef.current;
      if (!list.length) return;
      const ctrl = start();
      setItems((l) => l.map((it) => ({ ...it, status: "idle", progress: 0, error: undefined })));
      const per = new Map<string, number>();
      const bump = () => setProgress([...per.values()].reduce((a, b) => a + b, 0) / list.length);
      try {
        const results = await mapPool(list, concurrency, async (item) => {
          if (ctrl.signal.aborted) return [];
          patch(item.id, { status: "working", progress: 0 });
          try {
            const out = await fn(item.file, {
              signal: ctrl.signal,
              progress: (p) => {
                per.set(item.id, p);
                patch(item.id, { progress: p });
                bump();
              },
            });
            per.set(item.id, 1);
            bump();
            patch(item.id, { status: "done", progress: 1 });
            const arr = (Array.isArray(out) ? out : [out]).map((o) => ({ sourceSize: item.file.size, ...o, id: uid() }));
            // Show results as soon as each file finishes.
            setOutputs((prev) => [...prev, ...arr]);
            return arr;
          } catch (e) {
            per.set(item.id, 1);
            bump();
            patch(item.id, { status: "error", error: errorMessage(e) });
            return [];
          }
        });
        // Re-order to match the input order once everything is done.
        setOutputs(results.flat());
      } finally {
        setBusy(false);
      }
    },
    [patch],
  );

  const runAll = useCallback(async (fn: (files: File[], ctx: RunContext) => Promise<OutputInit[]>) => {
    const list = itemsRef.current;
    if (!list.length) return;
    const ctrl = start();
    setItems((l) => l.map((it) => ({ ...it, status: "working", progress: 0, error: undefined })));
    try {
      const out = await fn(
        list.map((it) => it.file),
        { signal: ctrl.signal, progress: setProgress },
      );
      setOutputs(out.map((o) => ({ ...o, id: uid() })));
      setItems((l) => l.map((it) => ({ ...it, status: "done", progress: 1 })));
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      setItems((l) => l.map((it) => ({ ...it, status: "error", error: undefined })));
    } finally {
      setProgress(1);
      setBusy(false);
    }
  }, []);

  return { items, outputs, busy, progress, error, add, remove, move, clear, cancel, runEach, runAll, setOutputs, setError };
}

export type Queue = ReturnType<typeof useQueue>;
