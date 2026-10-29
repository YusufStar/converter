import { uniqueNames } from "./files";

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Already-compressed payloads gain nothing from deflate; storing them is much faster.
const STORED = /^(image\/(jpeg|png|webp|avif|gif|heic)|video\/|audio\/|application\/(pdf|zip|gzip|x-7z|vnd\.openxmlformats))/;

export async function zipBlobs(files: NamedBlob[]): Promise<Blob> {
  const { zip } = await import("fflate");
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  await Promise.all(
    files.map(async (f, i) => {
      entries[names[i]] = [new Uint8Array(await f.blob.arrayBuffer()), { level: STORED.test(f.blob.type) ? 0 : 6 }];
    }),
  );
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, (err, out) => (err ? reject(err) : resolve(out))),
  );
  return new Blob([data as BlobPart], { type: "application/zip" });
}

/** Zips the files on click and downloads the archive. */
export async function downloadZip(files: NamedBlob[], zipName: string) {
  downloadBlob(await zipBlobs(files), zipName);
}
