// Main-thread side of qpdf: a small pool of workers, each with its own wasm instance.
import { WRONG_PASSWORD, decryptArgs, encryptArgs, outputOf, parseStatus, randomPassword, statusArgs, type Permissions, type Protection, type QpdfResult } from "./qpdf";

const MAX = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const idle: Worker[] = [];
const waiting: ((w: Worker) => void)[] = [];
let spawned = 0;

function spawn(): Worker {
  spawned++;
  return new Worker(new URL("./qpdf.worker.ts", import.meta.url), { type: "module" });
}

/** Starts one worker so the wasm is compiled before the first job. */
export function warmQpdf() {
  if (!spawned) idle.push(spawn());
}

function acquire(): Promise<Worker> {
  const w = idle.pop();
  if (w) return Promise.resolve(w);
  if (spawned < MAX) return Promise.resolve(spawn());
  return new Promise((resolve) => waiting.push(resolve));
}

function release(w: Worker) {
  const next = waiting.shift();
  if (next) next(w);
  else idle.push(w);
}

/** Runs one qpdf command on `input` (written to /in.pdf). The buffer is transferred. */
export async function runQpdf(args: string[], input: Uint8Array): Promise<QpdfResult> {
  const w = await acquire();
  let broken = false;
  try {
    return await new Promise<QpdfResult>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<QpdfResult>) => resolve(e.data);
      w.onerror = (e) => {
        broken = true;
        reject(new Error(`qpdf couldn't start (${e.message || "worker failed to load"})`));
      };
      w.postMessage({ args, input }, [input.buffer]);
    });
  } finally {
    if (!broken) release(w);
    else {
      // A worker whose script failed never answers again: replace it.
      w.terminate();
      spawned--;
      waiting.shift()?.(spawn());
    }
  }
}

export const ALREADY_LOCKED = "This PDF already has a password";
export const NOT_PROTECTED = "This PDF has no password or restrictions";

export async function pdfProtection(bytes: Uint8Array): Promise<Protection> {
  return parseStatus(await runQpdf(statusArgs(), bytes));
}

/** AES-256 copy of `bytes`. An empty owner password becomes a random one. */
export async function protectPdf(bytes: Uint8Array, user: string, owner: string, perms: Permissions): Promise<Uint8Array> {
  try {
    return outputOf(await runQpdf(encryptArgs(user, owner || randomPassword(), perms), bytes));
  } catch (e) {
    throw (e as Error).message === WRONG_PASSWORD ? new Error(ALREADY_LOCKED) : e;
  }
}

/** Decrypted copy. Files that open without a password lose their restrictions, whatever `password` is. */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<{ bytes: Uint8Array; was: Protection }> {
  const was = await pdfProtection(bytes.slice());
  if (was === "none") throw new Error(NOT_PROTECTED);
  return { bytes: outputOf(await runQpdf(decryptArgs(was === "locked" ? password : ""), bytes)), was };
}
