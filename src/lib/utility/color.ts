// Colour parsing and conversion. Internal model: sRGB channels 0–255 (floats, so
// hsl/lab round trips don't lose precision) + alpha 0–1. Lab/LCH follow CSS
// Color 4 (D50, Bradford adaptation); OKLab/OKLCH follow Björn Ottosson.

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ParsedColor extends RGBA {
  /** True when a lab/lch/oklab/oklch input fell outside sRGB and was clipped. */
  clipped: boolean;
}

// prettier-ignore
const NAMED_HEX = "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32";

export const NAMED_COLORS: Record<string, string> = Object.fromEntries(NAMED_HEX.split(" ").map((p) => p.split(":")));

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Rounds to `d` decimals and drops trailing zeros (−0 → 0). */
export function round(x: number, d = 0): string {
  const v = Number(x.toFixed(d));
  return String(Object.is(v, -0) ? 0 : v);
}

// ---------------------------------------------------------------- sRGB maths

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];
const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const LIN_TO_XYZ65: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ65_TO_LIN: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D65_TO_D50: Mat3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D50: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

const linOf = (c: RGBA): Vec3 => [toLinear(c.r / 255), toLinear(c.g / 255), toLinear(c.b / 255)];

/** Linear sRGB → channels 0–255; reports whether clipping was needed. */
function fromLinear(v: Vec3, a: number): ParsedColor {
  const g = v.map(toGamma);
  const clipped = g.some((x) => x < -1e-4 || x > 1 + 1e-4);
  return { r: clamp(g[0]) * 255, g: clamp(g[1]) * 255, b: clamp(g[2]) * 255, a, clipped };
}

export function toLab(c: RGBA): Vec3 {
  const xyz = mul(D65_TO_D50, mul(LIN_TO_XYZ65, linOf(c)));
  const f = xyz.map((v, i) => {
    const t = v / D50[i];
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

function fromLab([L, A, B]: Vec3, alpha: number): ParsedColor {
  const fy = (L + 16) / 116;
  const fx = A / 500 + fy;
  const fz = fy - B / 200;
  const xyz: Vec3 = [
    (fx ** 3 > EPS ? fx ** 3 : (116 * fx - 16) / KAPPA) * D50[0],
    (L > KAPPA * EPS ? fy ** 3 : L / KAPPA) * D50[1],
    (fz ** 3 > EPS ? fz ** 3 : (116 * fz - 16) / KAPPA) * D50[2],
  ];
  return fromLinear(mul(XYZ65_TO_LIN, mul(D50_TO_D65, xyz)), alpha);
}

export function toOklab(c: RGBA): Vec3 {
  const [r, g, b] = linOf(c);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Vec3, alpha: number): ParsedColor {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return fromLinear(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ],
    alpha,
  );
}

/** [L, a, b] → [L, C, H°]; hue is 0 for achromatic colours. */
function toPolar([L, A, B]: Vec3, achromatic: number): Vec3 {
  const C = Math.hypot(A, B);
  return [L, C, C < achromatic ? 0 : mod((Math.atan2(B, A) * 180) / Math.PI, 360)];
}
const fromPolar = ([L, C, H]: Vec3): Vec3 => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];

export const toLch = (c: RGBA) => toPolar(toLab(c), 0.02);
export const toOklch = (c: RGBA) => toPolar(toOklab(c), 0.0002);

export function toHsl(c: RGBA): Vec3 {
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  return [hueOf(r, g, b, max, d), s * 100, l * 100];
}

export function toHsv(c: RGBA): Vec3 {
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255;
  const max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  return [d < 1e-9 ? 0 : hueOf(r, g, b, max, d), max === 0 ? 0 : (d / max) * 100, max * 100];
}

export function toHwb(c: RGBA): Vec3 {
  const [h] = toHsv(c);
  return [h, (Math.min(c.r, c.g, c.b) / 255) * 100, (1 - Math.max(c.r, c.g, c.b) / 255) * 100];
}

/** Naive (device) CMYK in percent — no ICC profile. */
export function toCmyk(c: RGBA): [number, number, number, number] {
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) return [0, 0, 0, 100];
  return [((1 - r - k) / (1 - k)) * 100, ((1 - g - k) / (1 - k)) * 100, ((1 - b - k) / (1 - k)) * 100, k * 100];
}

function hueOf(r: number, g: number, b: number, max: number, d: number): number {
  const h = max === r ? mod((g - b) / d, 6) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return mod(h * 60, 360);
}

function fromHsl(h: number, s: number, l: number, a: number): ParsedColor {
  s = clamp(s / 100);
  l = clamp(l / 100);
  const k = (n: number) => mod(n + h / 30, 12);
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a, clipped: false };
}

function fromHsv(h: number, s: number, v: number, a: number): ParsedColor {
  s = clamp(s / 100);
  v = clamp(v / 100);
  const f = (n: number) => {
    const k = mod(n + h / 60, 6);
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255, a, clipped: false };
}

function fromHwb(h: number, w: number, bl: number, a: number): ParsedColor {
  w = clamp(w / 100);
  bl = clamp(bl / 100);
  if (w + bl >= 1) {
    const grey = (w / (w + bl)) * 255;
    return { r: grey, g: grey, b: grey, a, clipped: false };
  }
  const base = fromHsl(h, 100, 50, a);
  const f = (x: number) => (x / 255) * (1 - w - bl) * 255 + w * 255;
  return { r: f(base.r), g: f(base.g), b: f(base.b), a, clipped: false };
}

// ---------------------------------------------------------------- parsing

/** One CSS-ish argument → number. `pct` is the value 100% stands for (null = % not allowed). */
function num(tok: string | undefined, pct: number | null): number {
  if (tok === undefined) throw new Error("missing");
  if (tok === "none") return 0;
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(tok);
  if (!m) throw new Error(`bad number ${tok}`);
  const n = Number(m[1]);
  switch (m[2]?.toLowerCase()) {
    case "%":
      if (pct === null) throw new Error("% not allowed");
      return (n / 100) * pct;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    case "turn":
      return n * 360;
    default:
      return n;
  }
}

const alphaOf = (tok: string | undefined) => (tok === undefined ? 1 : clamp(num(tok, 1)));

function parseHex(hex: string): RGBA | null {
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length <= 4 ? [...hex].map((ch) => ch + ch).join("") : hex;
  const v = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return { r: v(0), g: v(1), b: v(2), a: full.length === 8 ? v(3) / 255 : 1 };
}

/**
 * Parses HEX (#rgb, #rgba, #rrggbb, #rrggbbaa, with or without #), rgb()/rgba(),
 * hsl()/hsla(), hsv()/hsb(), hwb(), cmyk()/device-cmyk(), lab(), lch(),
 * oklab(), oklch(), CSS named colours and bare "255, 107, 44" triples.
 * Commas, spaces and "/ alpha" syntax are all accepted.
 */
export function parseColor(input: string): ParsedColor | null {
  const s = input.trim().toLowerCase().replace(/;$/, "");
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0, clipped: false };
  if (NAMED_COLORS[s]) return { ...parseHex(NAMED_COLORS[s])!, clipped: false };
  const hex = parseHex(s.replace(/^(#|0x)/, ""));
  if (hex) return { ...hex, clipped: false };

  const fn = /^([a-z-]+)\s*\((.*)\)$/.exec(s);
  const name = fn ? fn[1] : "rgb";
  const body = fn ? fn[2] : s;
  const [main, slashAlpha] = body.split("/");
  const args = main.split(/[\s,]+/).filter(Boolean);
  if (slashAlpha !== undefined && slashAlpha.trim() === "") return null;
  const alphaTok = slashAlpha?.trim() ?? args[3];

  try {
    switch (name) {
      case "rgb":
      case "rgba": {
        if (args.length < 3 || args.length > 4) return null;
        const [r, g, b] = args.map((a) => clamp(num(a, 255), 0, 255));
        return { r, g, b, a: alphaOf(alphaTok), clipped: false };
      }
      case "hsl":
      case "hsla":
        if (args.length < 3 || args.length > 4) return null;
        return fromHsl(num(args[0], null), parseFloat(args[1]), parseFloat(args[2]), alphaOf(alphaTok));
      case "hsv":
      case "hsva":
      case "hsb":
      case "hsba":
        if (args.length < 3 || args.length > 4) return null;
        return fromHsv(num(args[0], null), parseFloat(args[1]), parseFloat(args[2]), alphaOf(alphaTok));
      case "hwb":
        if (args.length !== 3) return null;
        return fromHwb(num(args[0], null), parseFloat(args[1]), parseFloat(args[2]), alphaOf(slashAlpha?.trim()));
      case "cmyk":
      case "device-cmyk": {
        if (args.length < 4 || args.length > 5) return null;
        // Plain numbers are fractions (0–1) unless any of them is > 1, then they are percentages.
        const plainPct = args.slice(0, 4).some((a) => !a.endsWith("%") && Number(a) > 1);
        const [c, m, y, k] = args.slice(0, 4).map((a) => clamp(a.endsWith("%") || plainPct ? num(a.endsWith("%") ? a : `${a}%`, 1) : num(a, 1)));
        const f = (x: number) => (1 - x) * (1 - k) * 255;
        return { r: f(c), g: f(m), b: f(y), a: alphaOf(slashAlpha?.trim() ?? args[4]), clipped: false };
      }
      case "lab":
        if (args.length !== 3) return null;
        return fromLab([clamp(num(args[0], 100), 0, 100), num(args[1], 125), num(args[2], 125)], alphaOf(slashAlpha?.trim()));
      case "lch":
        if (args.length !== 3) return null;
        return fromLab(fromPolar([clamp(num(args[0], 100), 0, 100), Math.max(0, num(args[1], 150)), num(args[2], null)]), alphaOf(slashAlpha?.trim()));
      case "oklab":
        if (args.length !== 3) return null;
        return fromOklab([clamp(num(args[0], 1)), num(args[1], 0.4), num(args[2], 0.4)], alphaOf(slashAlpha?.trim()));
      case "oklch":
        if (args.length !== 3) return null;
        return fromOklab(fromPolar([clamp(num(args[0], 1)), Math.max(0, num(args[1], 0.4)), num(args[2], null)]), alphaOf(slashAlpha?.trim()));
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- formatting

const byte = (x: number) => Math.round(clamp(x, 0, 255));
const hex2 = (x: number) => byte(x).toString(16).padStart(2, "0");

export function toHex(c: RGBA, upper = false): string {
  const h = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ""}`;
  return upper ? h.toUpperCase() : h;
}

/** Rounded hue that wraps: 359.97 → 0. */
const hue = (h: number, d = 1) => round(Number(h.toFixed(d)) % 360, d);

export type Syntax = "legacy" | "modern";

/** All formats as CSS-style strings. Legacy = comma syntax (rgba/hsla), modern = space + "/ alpha". */
export function formatAll(c: RGBA, syntax: Syntax = "legacy", upper = false) {
  const a = round(c.a, 3);
  const alpha = c.a < 1;
  const fmt = (fn: string, parts: string[], legacyAlphaFn = fn) =>
    syntax === "modern"
      ? `${fn}(${parts.join(" ")}${alpha ? ` / ${a}` : ""})`
      : alpha
        ? `${legacyAlphaFn}(${parts.join(", ")}, ${a})`
        : `${fn}(${parts.join(", ")})`;
  const modernOnly = (fn: string, parts: string[]) => `${fn}(${parts.join(" ")}${alpha ? ` / ${a}` : ""})`;

  const [h, s, l] = toHsl(c);
  const [hv, sv, v] = toHsv(c);
  const [hw, w, bl] = toHwb(c);
  const cmyk = toCmyk(c);
  const lab = toLab(c);
  const lch = toLch(c);
  const oklab = toOklab(c);
  const oklch = toOklch(c);
  return {
    hex: toHex(c, upper),
    rgb: fmt("rgb", [c.r, c.g, c.b].map((x) => String(byte(x))), "rgba"),
    hsl: fmt("hsl", [hue(h), `${round(s, 1)}%`, `${round(l, 1)}%`], "hsla"),
    hsv: fmt("hsv", [hue(hv), `${round(sv, 1)}%`, `${round(v, 1)}%`], "hsva"),
    hwb: modernOnly("hwb", [hue(hw), `${round(w, 1)}%`, `${round(bl, 1)}%`]),
    cmyk: `cmyk(${cmyk.map((x) => `${round(x, 1)}%`).join(", ")})`,
    lab: modernOnly("lab", [round(lab[0], 2), round(lab[1], 2), round(lab[2], 2)]),
    lch: modernOnly("lch", [round(lch[0], 2), round(lch[1], 2), hue(lch[2], 2)]),
    oklab: modernOnly("oklab", [round(oklab[0], 4), round(oklab[1], 4), round(oklab[2], 4)]),
    oklch: modernOnly("oklch", [`${round(oklch[0] * 100, 2)}%`, round(oklch[1], 4), hue(oklch[2], 2)]),
  };
}

export type FormatId = keyof ReturnType<typeof formatAll>;

/** Closest CSS named colour by distance in OKLab. */
export function nearestNamed(c: RGBA): { name: string; exact: boolean } {
  const target = toOklab(c);
  let best = { name: "black", d: Infinity };
  for (const [name, hex] of Object.entries(NAMED_COLORS)) {
    const o = toOklab(parseHex(hex)!);
    const d = Math.hypot(o[0] - target[0], o[1] - target[1], o[2] - target[2]);
    if (d < best.d) best = { name, d };
  }
  return { name: best.name, exact: NAMED_COLORS[best.name] === toHex({ ...c, a: 1 }).slice(1) };
}

// ---------------------------------------------------------------- contrast (WCAG 2.x)

/** Colour with alpha composited over an opaque background. */
export function over(c: RGBA, bg: RGBA): RGBA {
  return { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 };
}

export function luminance(c: RGBA): number {
  const [r, g, b] = linOf(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg: RGBA, bg: RGBA): number {
  const solid = over(fg, bg);
  const [hi, lo] = [luminance(solid), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.x levels passed for a contrast ratio. */
export function wcag(ratio: number) {
  return { aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7, aaaLarge: ratio >= 4.5 };
}

export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
