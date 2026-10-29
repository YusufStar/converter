// qpdf (WebAssembly) for adding and removing PDF passwords. This file holds the
// pure parts — command lines, result parsing and a runner around one module
// instance — so Node tests can drive the real wasm build directly.

export interface QpdfInstance {
  callMain(args: string[]): number;
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
}

export type QpdfFactory = (opts: { locateFile: () => string }) => Promise<QpdfInstance>;

export interface QpdfResult {
  code: number;
  /** stdout + stderr lines, program name prefix removed. */
  output: string;
  /** /out.pdf when the command wrote one. */
  file?: Uint8Array;
  /** The wasm runtime aborted; the instance must not be reused. */
  crashed?: boolean;
}

export const IN = "/in.pdf";
export const OUT = "/out.pdf";

/** One qpdf module instance; commands run one at a time against its in-memory FS. */
export async function createQpdf(factory: QpdfFactory, wasmUrl: string) {
  // The glue ignores Module.print and binds console.log/error once per instance,
  // so capture output by swapping the console just while the instance is created.
  const lines: string[] = [];
  const { log, error } = console;
  const sink = (...a: unknown[]) => void lines.push(a.join(" "));
  console.log = console.error = sink;
  let pending: Promise<QpdfInstance>;
  try {
    pending = factory({ locateFile: () => wasmUrl });
  } finally {
    console.log = log;
    console.error = error;
  }
  const qpdf = await pending;

  return {
    run(args: string[], input?: Uint8Array): QpdfResult {
      lines.length = 0;
      if (input) qpdf.FS.writeFile(IN, input);
      let code: number;
      try {
        code = qpdf.callMain(args);
      } catch (e) {
        return { code: -1, output: `qpdf stopped (${e})`, crashed: true };
      }
      let file: Uint8Array | undefined;
      try {
        file = qpdf.FS.readFile(OUT);
      } catch {
        // command wrote no file
      }
      for (const p of [IN, OUT]) {
        try {
          qpdf.FS.unlink(p);
        } catch {
          // not there
        }
      }
      // "./this.program: /in.pdf: invalid password" → "invalid password"
      const output = lines.map((l) => l.replace(/^\S*?: (\/in\.pdf: )?/, "")).join("\n");
      return { code, output, file };
    },
  };
}

export type Qpdf = Awaited<ReturnType<typeof createQpdf>>;

export interface Permissions {
  print: boolean;
  /** Copy text and images. */
  copy: boolean;
  /** Change pages and content. */
  modify: boolean;
  /** Add comments / annotations. */
  annotate: boolean;
  /** Fill in form fields. */
  forms: boolean;
}

export const ALL_ALLOWED: Permissions = { print: true, copy: true, modify: true, annotate: true, forms: true };

const yn = (b: boolean) => (b ? "y" : "n");

/** qpdf command line for AES-256 encryption. Restrictions only bind readers who open with the user password. */
export function encryptArgs(user: string, owner: string, p: Permissions): string[] {
  return [
    "--encrypt",
    `--user-password=${user}`,
    `--owner-password=${owner}`,
    "--bits=256",
    `--print=${p.print ? "full" : "none"}`,
    `--extract=${yn(p.copy)}`,
    `--modify-other=${yn(p.modify)}`,
    `--assemble=${yn(p.modify)}`,
    `--annotate=${yn(p.annotate)}`,
    `--form=${yn(p.forms)}`,
    "--",
    IN,
    OUT,
  ];
}

export const decryptArgs = (password: string) => [`--password=${password}`, "--decrypt", IN, OUT];

export const statusArgs = () => ["--requires-password", IN];

/** none = not encrypted, restricted = opens without a password but has an owner password, locked = needs a password. */
export type Protection = "none" | "restricted" | "locked";

export const WRONG_PASSWORD = "Wrong password";
export const NOT_PDF = "This file isn't a readable PDF";

const badPassword = (r: QpdfResult) => /invalid password/i.test(r.output);

function failure(r: QpdfResult): Error {
  if (r.crashed) return new Error(r.output);
  if (badPassword(r)) return new Error(WRONG_PASSWORD);
  const why = r.output.trim().split("\n").pop();
  return new Error(why ? `${NOT_PDF} (${why})` : NOT_PDF);
}

/**
 * `--requires-password`: 0 or "invalid password" = needs one, 3 = encrypted
 * without an open password, 2 with no message = not encrypted.
 */
export function parseStatus(r: QpdfResult): Protection {
  if (r.code === 0 || badPassword(r)) return "locked";
  if (r.code === 3) return "restricted";
  if (r.code === 2 && !r.output.trim()) return "none";
  throw failure(r);
}

/** The written file, or an error a person can act on. Exit code 3 = success with warnings. */
export function outputOf(r: QpdfResult): Uint8Array {
  if ((r.code === 0 || r.code === 3) && r.file?.length) return r.file;
  throw failure(r);
}

/** Random owner password, so restrictions can't be lifted with an empty one. */
export function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x");
}
