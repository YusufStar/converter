// Barcode reading client: a pool of scan workers (see scan.worker.ts) plus result helpers.

import type { Position } from "zxing-wasm/reader";
import { WorkerPool, poolSize } from "./worker-pool";

export interface ScanCode {
  format: string;
  text: string;
  position: Position;
  contentType: string;
}

export interface ScanResult {
  codes: ScanCode[];
  /** Pixel size the positions refer to (0 when zxing decoded the file itself). */
  width: number;
  height: number;
}

export type ScanJob = { kind: "file"; file: Blob } | { kind: "pixels"; buffer: ArrayBuffer; width: number; height: number };

let pool: WorkerPool | null = null;

export function scanPool(): WorkerPool {
  pool ??= new WorkerPool(() => new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" }), poolSize(4));
  return pool;
}

export const scanFile = (file: Blob, signal?: AbortSignal) => scanPool().run<ScanResult>({ kind: "file", file } satisfies ScanJob, { signal });

export const scanPixels = (img: ImageData) =>
  scanPool().run<ScanResult>({ kind: "pixels", buffer: img.data.buffer, width: img.width, height: img.height } satisfies ScanJob, { transfer: [img.data.buffer] });

const LABELS: Record<string, string> = {
  QRCode: "QR Code",
  MicroQRCode: "Micro QR",
  RMQRCode: "rMQR",
  DataMatrix: "Data Matrix",
  AztecCode: "Aztec",
  EAN13: "EAN-13",
  EAN8: "EAN-8",
  UPCA: "UPC-A",
  UPCE: "UPC-E",
  Code128: "Code 128",
  Code39: "Code 39",
  Code39Ext: "Code 39",
  Code39Std: "Code 39",
  Code93: "Code 93",
  ITF14: "ITF-14",
  DataBar: "GS1 DataBar",
};

export const formatLabel = (format: string) => LABELS[format] ?? format;

/** Links worth an "Open" button: web pages only (no javascript:, data:, file: …). */
export function webLink(text: string): string | null {
  const s = text.trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return null;
  try {
    return new URL(s).href;
  } catch {
    return null;
  }
}

/** Reading order: top to bottom, left to right (codes on roughly the same line count as one row). */
export function readingOrder<T extends { position: Position }>(codes: T[]): T[] {
  const box = (p: Position) => {
    const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
    const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
    return { x: Math.min(...xs), y: Math.min(...ys), h: Math.max(...ys) - Math.min(...ys) };
  };
  return [...codes].sort((a, b) => {
    const [p, q] = [box(a.position), box(b.position)];
    const band = Math.max(p.h, q.h) / 2;
    return Math.abs(p.y - q.y) > band ? p.y - q.y : p.x - q.x;
  });
}

export const polygon = (p: Position) => [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((pt) => `${pt.x},${pt.y}`).join(" ");
