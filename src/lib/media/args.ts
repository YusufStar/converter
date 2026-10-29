// Pure ffmpeg argument builders + helpers. No browser APIs here: everything is unit-tested in Node.

export type VideoFormat = "mp4" | "webm" | "mov" | "mkv" | "avi" | "gif";
export type AudioFormat = "mp3" | "m4a" | "aac" | "wav" | "ogg" | "opus" | "flac" | "aiff";
export type FrameFormat = "jpg" | "png" | "webp";
export type Rotation = 0 | 90 | 180 | 270;

export const VIDEO_FORMATS: VideoFormat[] = ["mp4", "webm", "mov", "mkv", "avi", "gif"];
export const AUDIO_FORMATS: AudioFormat[] = ["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "aiff"];
export const LOSSLESS_AUDIO = new Set<AudioFormat>(["wav", "flac", "aiff"]);

export const MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  aiff: "audio/aiff",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "3gp", "3g2", "ts", "mts", "m2ts", "mpg", "mpeg", "ogv", "vob", "mxf", "f4v"];
const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "aif", "aiff", "wma", "amr", "ac3", "caf", "weba", "mka"];

export const VIDEO_ACCEPT = ["video/*", ...VIDEO_EXT.map((e) => `.${e}`)].join(",");
export const AUDIO_ACCEPT = ["audio/*", ...AUDIO_EXT.map((e) => `.${e}`)].join(",");

export function isAudioFile(file: { name: string; type: string }): boolean {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  return file.type.startsWith("audio/") || AUDIO_EXT.includes(ext);
}

// ---------------------------------------------------------------- time

/**
 * "65", "1:05", "01:05.5", "00:01:05,5" → seconds. Empty → null, garbage → NaN.
 * A comma works as the decimal separator (Turkish keyboards).
 */
export function parseTime(text: string): number | null {
  const s = text.trim().replace(",", ".");
  if (!s) return null;
  if (!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(s)) return NaN;
  const parts = s.split(":").map(Number);
  // Every part after the first is a 0–59 minute/second field.
  if (parts.slice(1).some((p) => p >= 60)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** 2 → "0:02", 65.5 → "1:05.5", 3725 → "1:02:05". */
export function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec * 10) / 10);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = (s < 10 ? "0" : "") + (Number.isInteger(s) ? String(s) : s.toFixed(1));
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Start/end text fields → seconds. With `isLength` the second field is a duration
 * (GIF tool). Errors: "invalid" (unparsable), "order" (end ≤ start).
 */
export function parseRange(startText: string, endText: string, isLength = false): { start: number | null; end: number | null; error?: "invalid" | "order" } {
  const start = parseTime(startText);
  const second = parseTime(endText);
  if (Number.isNaN(start) || Number.isNaN(second)) return { start: null, end: null, error: "invalid" };
  const end = second === null ? null : isLength ? (start ?? 0) + second : second;
  if (end !== null && end <= (start ?? 0)) return { start, end, error: "order" };
  return { start, end };
}

/** Seconds of output for an input of `duration` cut to [start, end). */
export function clipLength(duration: number | undefined, start: number | null, end: number | null): number | undefined {
  const from = start ?? 0;
  const to = Math.min(end ?? Infinity, duration ?? Infinity);
  return Number.isFinite(to) ? Math.max(0, to - from) : undefined;
}

/** -ss before -i (fast input seek, still frame-accurate when re-encoding), -t after it. */
function cut(input: string, start: number | null, end: number | null): string[] {
  const args: string[] = [];
  if (start) args.push("-ss", fmtNum(start));
  args.push("-i", input);
  if (end != null) args.push("-t", fmtNum(Math.max(0.01, end - (start ?? 0))));
  return args;
}

const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000);

// ---------------------------------------------------------------- probe log

export interface MediaInfo {
  /** seconds */
  duration?: number;
  /** Display size (rotation metadata already applied). */
  width?: number;
  height?: number;
  fps?: number;
  /** Video codec name, e.g. "h264". */
  video?: string;
  /** Codec profile, e.g. "High". */
  profile?: string;
  pixFmt?: string;
  /** Clockwise display rotation from the container's matrix (0/90/180/270). */
  rotation?: number;
  /** Audio codec name, e.g. "aac". */
  audio?: string;
  sampleRate?: number;
  /** Channel layout, e.g. "stereo". */
  channels?: string;
}

/** Reads `ffmpeg -i file` output (stream info printed to stderr). */
export function parseInfo(log: string): MediaInfo {
  const info: MediaInfo = {};
  const d = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  if (d) info.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  // Cover art in MP3/M4A is a "Video: mjpeg … (attached pic)" stream — not a real video.
  const video = log.split("\n").find((l) => /Stream #\d+:\d+.*: Video: /.test(l) && !l.includes("(attached pic)"));
  if (video) {
    info.video = /Video: (\w+)/.exec(video)?.[1];
    const profile = /Video: \w+ \(([^)]+)\)/.exec(video)?.[1];
    if (profile && !profile.includes(" / ")) info.profile = profile;
    const pix = /Video: [^,]*, (\w+)/.exec(video)?.[1];
    if (pix) info.pixFmt = pix;
    const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(video);
    if (size) {
      info.width = Number(size[1]);
      info.height = Number(size[2]);
    }
    const fps = /([\d.]+) fps/.exec(video);
    if (fps) info.fps = Number(fps[1]);
    const rot = /rotation of (-?[\d.]+) degrees/.exec(log);
    if (rot) {
      // The display matrix angle is counter-clockwise.
      info.rotation = (((-Math.round(Number(rot[1]) / 90) * 90) % 360) + 360) % 360;
      if (info.rotation % 180 === 90 && info.width && info.height) [info.width, info.height] = [info.height, info.width];
    }
  }
  const audio = /Stream #\d+:\d+.*: Audio: (\w+)[^\n]*?(\d+) Hz(?:, ([\w.()]+))?/.exec(log);
  if (audio) {
    info.audio = audio[1];
    info.sampleRate = Number(audio[2]);
    if (audio[3]) info.channels = audio[3];
  }
  return info;
}

const NOISE = /^(\s*$|frame=|size=|video:|\s*Stream mapping|\s*Stream #|\s*Metadata:|\s{4,}\w+\s*:|Press \[q\]|\[out#)/;

/** Last meaningful stderr lines, for a readable error when ffmpeg exits non-zero. */
export function failureMessage(lines: string[]): string {
  const useful = lines
    .filter((l) => !NOISE.test(l))
    .map((l) => l.trim())
    .filter((l) => l !== "Conversion failed!" && !l.startsWith("Aborted("));
  return useful.slice(-2).join(" · ") || "FFmpeg failed";
}

// ---------------------------------------------------------------- threads

/**
 * Threads per pool for the multi-threaded core. Measured (10 s 720p → H.264 veryfast,
 * 10-core M-series): 1 thread 8.9 s, 4 threads 2.3 s. x264 at 6+ threads crashes its
 * lookahead workers in this wasm build ("function signature mismatch") and silently
 * drops to one thread, so 4 is the cap; more decoder/filter threads gained nothing.
 */
export const threadCount = (cores: number | undefined) => Math.max(1, Math.min(4, cores || 4));

/**
 * Pins every pool ffmpeg would otherwise size from the CPU count (decoders, encoders,
 * filter graphs) — auto threading on an 8+ core machine hits the x264 crash above and
 * can exhaust the core's 32 pre-spawned workers (a deadlock). `args` ends with the
 * (single) output path.
 */
export function withThreads(args: string[], n: number): string[] {
  const inputs = args.filter((a) => a === "-i").length;
  const dec = String(Math.max(1, Math.floor(n / Math.max(1, inputs))));
  const filt = String(Math.max(1, Math.ceil(n / 2)));
  const out = ["-filter_threads", filt, "-filter_complex_threads", filt];
  args.forEach((a, i) => {
    if (a === "-i") out.push("-threads", dec);
    else if (i === args.length - 1) out.push("-threads", String(n));
    out.push(a);
  });
  return out;
}

// ---------------------------------------------------------------- sizes

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Fits a video so its short side is at most `short` px ("720p" also means 720×1280
 * for portrait), keeps the aspect ratio, never upscales, and returns even sizes
 * (H.264 4:2:0 needs them).
 */
export function fitSize(width: number, height: number, short: number | null): { width: number; height: number } {
  const scale = short ? Math.min(1, short / Math.min(width, height)) : 1;
  return { width: even(width * scale), height: even(height * scale) };
}

/** Video bitrate (kbit/s) that lands an output of `seconds` near `targetMB` MiB, after audio + ~5% container overhead. */
export function targetVideoKbps(targetMB: number, seconds: number, audioKbps: number): number {
  const totalKbps = (targetMB * 1024 * 1024 * 8) / seconds / 1000;
  return Math.max(32, Math.floor(totalKbps * 0.95 - audioKbps));
}

// ---------------------------------------------------------------- quality

/** Quality 0–100 → x264 CRF (75 → 23, the x264 default). */
export const x264Crf = (q: number) => Math.round(38 - q * 0.2);
/** Quality 0–100 → libvpx VP8 CRF (4–63). */
export const vp8Crf = (q: number) => Math.round(46 - q * 0.4);
/** Quality 0–100 → MPEG-4 Part 2 -q:v (2 best – 31 worst). */
export const mpeg4Q = (q: number) => Math.round(2 + (100 - q) * 0.16);

// ---------------------------------------------------------------- video

export interface VideoOptions {
  format: Exclude<VideoFormat, "gif">;
  /** Short-side target in px, null = original. */
  height: number | null;
  /** 0–100, mapped to the codec's CRF. Ignored when videoKbps is set. */
  quality: number;
  /** Fixed bitrate instead of constant quality (target-size compression). */
  videoKbps?: number | null;
  audioKbps: number;
  fps: number | null;
  start: number | null;
  end: number | null;
  mute: boolean;
  rotate: Rotation;
}

export interface IO {
  input: string;
  output: string;
  info: MediaInfo;
}

const ROTATE: Record<Rotation, string | null> = { 0: null, 90: "transpose=1", 180: "hflip,vflip", 270: "transpose=2" };

/** Output display size for the given options (null when the input size is unknown). */
export function outputSize(info: MediaInfo, height: number | null, rotate: Rotation): { width: number; height: number } | null {
  if (!info.width || !info.height) return null;
  const s = fitSize(info.width, info.height, height);
  return rotate % 180 ? { width: s.height, height: s.width } : s;
}

function scaleFilter(info: MediaInfo, height: number | null): string {
  if (!info.width || !info.height) {
    // Unknown size: still force even dimensions so x264 can't choke.
    return height ? `scale=-2:'min(${height},ih)'` : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  }
  const s = fitSize(info.width, info.height, height);
  return `scale=${s.width}:${s.height}`;
}

export function videoCodec(o: Pick<VideoOptions, "format" | "quality" | "videoKbps">): string[] {
  const kbps = o.videoKbps ?? null;
  switch (o.format) {
    case "webm":
      // ponytail: VP8 realtime — VP9 runs ~5–10× slower in single-threaded wasm.
      return ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", ...(kbps ? ["-b:v", `${kbps}k`] : ["-crf", String(vp8Crf(o.quality)), "-b:v", "20M"])];
    case "avi":
      return ["-c:v", "mpeg4", "-vtag", "xvid", ...(kbps ? ["-b:v", `${kbps}k`] : ["-q:v", String(mpeg4Q(o.quality))])];
    default:
      return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        ...(kbps ? ["-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`] : ["-crf", String(x264Crf(o.quality))]),
        "-pix_fmt",
        "yuv420p",
      ];
  }
}

export function audioCodec(format: VideoOptions["format"], kbps: number): string[] {
  const codec = format === "webm" ? "libopus" : format === "avi" ? "libmp3lame" : "aac";
  return ["-c:a", codec, "-b:a", `${kbps}k`];
}

export function videoArgs(o: VideoOptions, { input, output, info }: IO): string[] {
  const filters = [scaleFilter(info, o.height), o.fps ? `fps=${o.fps}` : null, ROTATE[o.rotate]].filter(Boolean);
  return [
    ...cut(input, o.start, o.end),
    "-vf",
    filters.join(","),
    ...videoCodec(o),
    ...(o.mute ? ["-an"] : audioCodec(o.format, o.audioKbps)),
    "-sn",
    "-dn",
    ...(o.format === "mp4" || o.format === "mov" ? ["-movflags", "+faststart"] : []),
    output,
  ];
}

// ---------------------------------------------------------------- gif

export interface GifOptions {
  fps: number;
  /** null = input width */
  width: number | null;
  loop: boolean;
  /** palettegen/paletteuse instead of the generic 256-colour palette */
  hq: boolean;
  start: number | null;
  end: number | null;
  rotate: Rotation;
}

export function gifArgs(o: GifOptions, { input, output, info }: IO): string[] {
  const w = o.width && info.width ? Math.min(o.width, info.width) : (o.width ?? info.width);
  const base = [ROTATE[o.rotate], `fps=${o.fps}`, w ? `scale=${w}:-1:flags=lanczos` : null].filter(Boolean).join(",");
  const vf = o.hq ? `${base},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle` : base;
  return [...cut(input, o.start, o.end), "-vf", vf, "-loop", o.loop ? "0" : "-1", "-an", output];
}

// ---------------------------------------------------------------- trim / mute

/** Container → codecs used when a trim has to re-encode. */
export function reencodeFormat(ext: string): VideoOptions["format"] {
  return ext === "webm" ? "webm" : ext === "avi" ? "avi" : ext === "mov" ? "mov" : ext === "mkv" ? "mkv" : "mp4";
}

const COPY_EXT = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "ts", "flv", "3gp", "mpg", "mpeg", "ogv", "wmv"];
const ENCODE_EXT = ["mp4", "m4v", "mov", "mkv", "webm", "avi"];

/** Output extension for trim/mute: same container as the input when ffmpeg can write it, else Matroska (holds anything). */
export function sameContainer(ext: string, reencode: boolean): string {
  return (reencode ? ENCODE_EXT : COPY_EXT).includes(ext) ? ext : "mkv";
}

export function trimArgs(o: { start: number | null; end: number | null; precise: boolean; ext: string }, { input, output }: IO): string[] {
  if (!o.precise) {
    // Stream copy: instant and lossless, cuts snap to the keyframe before `start`.
    return [...cut(input, o.start, o.end), "-c", "copy", "-avoid_negative_ts", "make_zero", "-sn", "-dn", output];
  }
  const format = reencodeFormat(o.ext);
  const opts: VideoOptions = { format, height: null, quality: 80, audioKbps: 160, fps: null, start: null, end: null, mute: false, rotate: 0 };
  return [
    ...cut(input, o.start, o.end),
    ...videoCodec(opts),
    ...audioCodec(format, 160),
    "-sn",
    "-dn",
    ...(format === "mp4" || format === "mov" ? ["-movflags", "+faststart"] : []),
    output,
  ];
}

export function muteArgs({ input, output }: IO): string[] {
  return ["-i", input, "-c", "copy", "-an", "-sn", "-dn", output];
}

// ---------------------------------------------------------------- audio

export interface AudioOptions {
  format: AudioFormat;
  kbps: number;
  /** null = keep */
  sampleRate: number | null;
  /** null = keep */
  channels: 1 | 2 | null;
  start: number | null;
  end: number | null;
  /** percent, 100 = unchanged */
  volume: number;
  normalize: boolean;
  /** seconds, 0 = off */
  fadeIn: number;
  fadeOut: number;
}

const AUDIO_CODEC: Record<AudioFormat, string[]> = {
  mp3: ["-c:a", "libmp3lame"],
  m4a: ["-c:a", "aac"],
  aac: ["-c:a", "aac"],
  wav: ["-c:a", "pcm_s16le"],
  ogg: ["-c:a", "libvorbis"],
  opus: ["-c:a", "libopus"],
  flac: ["-c:a", "flac"],
  aiff: ["-c:a", "pcm_s16be"],
};

export function audioFilters(o: AudioOptions, length: number | undefined): string[] {
  const f: string[] = [];
  if (o.normalize) f.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  else if (o.volume !== 100) f.push(`volume=${(o.volume / 100).toFixed(2)}`);
  if (o.fadeIn > 0) f.push(`afade=t=in:st=0:d=${o.fadeIn}`);
  if (o.fadeOut > 0 && length) f.push(`afade=t=out:st=${fmtNum(Math.max(0, length - o.fadeOut))}:d=${o.fadeOut}`);
  return f;
}

export function audioArgs(o: AudioOptions, { input, output, info }: IO): string[] {
  const filters = audioFilters(o, clipLength(info.duration, o.start, o.end));
  // loudnorm upsamples to 192 kHz internally; bring it back to the source rate. Opus picks 48 kHz itself.
  const rate = o.format === "opus" ? null : (o.sampleRate ?? (o.normalize ? (info.sampleRate ?? 48000) : null));
  return [
    ...cut(input, o.start, o.end),
    "-vn",
    "-sn",
    "-dn",
    ...(filters.length ? ["-af", filters.join(",")] : []),
    ...AUDIO_CODEC[o.format],
    ...(LOSSLESS_AUDIO.has(o.format) ? [] : ["-b:a", `${o.kbps}k`]),
    ...(rate ? ["-ar", String(rate)] : []),
    ...(o.channels ? ["-ac", String(o.channels)] : []),
    ...(o.format === "m4a" ? ["-movflags", "+faststart"] : []),
    output,
  ];
}

// ---------------------------------------------------------------- frames

export interface FrameOptions {
  /** seconds between images */
  every: number;
  format: FrameFormat;
  width: number | null;
  start: number | null;
  end: number | null;
}

/**
 * Image sequence ffmpeg writes for a frame format. ponytail: the wasm build's mjpeg
 * encoder crashes ("memory access out of bounds") from the 2nd frame on, so JPG
 * frames come out as PNG and the browser re-encodes them.
 */
export const frameExt = (f: FrameFormat) => (f === "webp" ? "webp" : "png");

/** `output` is an ffmpeg image-sequence path, e.g. "/out1/%04d.png" (see frameExt). */
export function framesArgs(o: FrameOptions, { input, output, info }: IO): string[] {
  const w = o.width && info.width ? Math.min(o.width, info.width) : o.width;
  const vf = [`fps=1/${o.every}`, w ? `scale=${w}:-2:flags=lanczos` : null].filter(Boolean).join(",");
  const codec = o.format === "webp" ? ["-c:v", "libwebp", "-quality", "85"] : [];
  // ponytail: hard cap so a tiny interval on a long video can't exhaust tab memory.
  return [...cut(input, o.start, o.end), "-vf", vf, ...codec, "-frames:v", "1000", "-an", output];
}
