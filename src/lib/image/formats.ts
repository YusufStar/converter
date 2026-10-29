import { splitName } from "../files";

export type ImageFormat = "png" | "jpg" | "webp" | "avif" | "gif" | "bmp" | "ico" | "tiff" | "pdf";
/** "same" keeps each file's own format (falls back to PNG for formats we can't write). */
export type OutputFormat = ImageFormat | "same";

export const FORMATS: Record<ImageFormat, { ext: string; mime: string; label: string; lossy: boolean; alpha: boolean }> = {
  png: { ext: "png", mime: "image/png", label: "PNG", lossy: false, alpha: true },
  jpg: { ext: "jpg", mime: "image/jpeg", label: "JPG", lossy: true, alpha: false },
  webp: { ext: "webp", mime: "image/webp", label: "WEBP", lossy: true, alpha: true },
  avif: { ext: "avif", mime: "image/avif", label: "AVIF", lossy: true, alpha: true },
  gif: { ext: "gif", mime: "image/gif", label: "GIF", lossy: false, alpha: true },
  bmp: { ext: "bmp", mime: "image/bmp", label: "BMP", lossy: false, alpha: false },
  ico: { ext: "ico", mime: "image/x-icon", label: "ICO", lossy: false, alpha: true },
  tiff: { ext: "tiff", mime: "image/tiff", label: "TIFF", lossy: false, alpha: true },
  pdf: { ext: "pdf", mime: "application/pdf", label: "PDF", lossy: true, alpha: false },
};

export const OUTPUT_FORMATS: ImageFormat[] = ["png", "jpg", "webp", "avif", "gif", "bmp", "tiff", "ico", "pdf"];

export const IMAGE_ACCEPT =
  "image/*,.png,.jpg,.jpeg,.jfif,.webp,.avif,.gif,.bmp,.ico,.svg,.heic,.heif,.tif,.tiff";
export const IMAGE_FORMATS_LABEL = "PNG, JPG, WEBP, AVIF, GIF, BMP, ICO, SVG, HEIC, TIFF";

export type InputKind = "svg" | "heic" | "tiff" | "raster";

export function inputKind(file: { name: string; type: string }): InputKind {
  const type = file.type.toLowerCase();
  const ext = splitName(file.name).ext;
  if (type === "image/svg+xml" || ext === "svg") return "svg";
  if (/^image\/hei[cf]/.test(type) || ext === "heic" || ext === "heif") return "heic";
  if (type === "image/tiff" || ext === "tif" || ext === "tiff") return "tiff";
  return "raster";
}

/** What "same format" means for a given input. */
export function sameFormat(file: { name: string; type: string }): ImageFormat {
  const type = file.type.toLowerCase();
  const ext = splitName(file.name).ext;
  if (type === "image/jpeg" || ["jpg", "jpeg", "jfif"].includes(ext)) return "jpg";
  if (type === "image/webp" || ext === "webp") return "webp";
  if (type === "image/avif" || ext === "avif") return "avif";
  if (type === "image/gif" || ext === "gif") return "gif";
  if (type === "image/bmp" || ext === "bmp") return "bmp";
  if (ext === "ico") return "ico";
  if (inputKind(file) === "tiff") return "tiff";
  // HEIC can't be written by browsers; JPG is what phones share it as.
  if (inputKind(file) === "heic") return "jpg";
  return "png";
}

export function resolveFormat(out: OutputFormat, file: { name: string; type: string }): ImageFormat {
  return out === "same" ? sameFormat(file) : out;
}
