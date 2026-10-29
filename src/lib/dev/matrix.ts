// Renders a 2D symbol (zxing-wasm writer's one-channel module image: 0 = dark, 255 = light)
// as SVG with our own colours, quiet zone, size and optional centre logo.

export interface ModuleMatrix {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface MatrixStyle {
  /** Output width/height in px. */
  size: number;
  /** Quiet zone in modules. */
  margin: number;
  fg: string;
  bg: string;
  /** Leave the background out (the logo pad still uses `bg`). */
  transparent?: boolean;
  /** Centre image as a data: URI, and its width as a fraction of the symbol (0..0.3). */
  logo?: { href: string; scale: number } | null;
}

export const isDark = (m: ModuleMatrix, x: number, y: number) => m.data[y * m.width + x] < 128;

/** One path of horizontal runs per row: compact and seam-free at any scale. */
export function matrixPath(m: ModuleMatrix, offset = 0): string {
  let d = "";
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; ) {
      if (!isDark(m, x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < m.width && isDark(m, x, y)) x++;
      d += `M${start + offset} ${y + offset}h${x - start}v1h${start - x}z`;
    }
  }
  return d;
}

/** Logo box in module units (centred, with a one-module pad in the background colour). */
export function logoBox(m: ModuleMatrix, margin: number, scale: number) {
  const side = Math.max(1, Math.min(0.3, scale) * m.width);
  const x = margin + (m.width - side) / 2;
  const y = margin + (m.height - side) / 2;
  return { x, y, side, pad: 1 };
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function matrixSvg(m: ModuleMatrix, { size, margin, fg, bg, transparent, logo }: MatrixStyle): string {
  const w = m.width + margin * 2;
  const h = m.height + margin * 2;
  const height = Math.round((size * h) / w);
  let extra = "";
  if (logo) {
    const b = logoBox(m, margin, logo.scale);
    extra =
      `<rect x="${b.x - b.pad}" y="${b.y - b.pad}" width="${b.side + b.pad * 2}" height="${b.side + b.pad * 2}" rx="${b.pad}" fill="${attr(bg)}"/>` +
      `<image href="${attr(logo.href)}" x="${b.x}" y="${b.y}" width="${b.side}" height="${b.side}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">` +
    (transparent ? "" : `<rect width="${w}" height="${h}" fill="${attr(bg)}"/>`) +
    `<path fill="${attr(fg)}" d="${matrixPath(m, margin)}"/>` +
    extra +
    `</svg>`
  );
}
