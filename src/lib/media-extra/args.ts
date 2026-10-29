// Pure ffmpeg argument builders for resize / speed / rotate / merge / trim-audio. No browser APIs: unit-tested in Node.

import { AUDIO_FORMATS, audioCodec, videoCodec, type AudioFormat, type MediaInfo, type Rotation, type VideoOptions } from "../media/args";

export type VideoOut = "mp4" | "webm" | "mov" | "mkv";

/** Re-encode container: the input's when it's a modern one ffmpeg writes well, else MP4. */
export function videoOut(ext: string): VideoOut {
  return ext === "webm" || ext === "mov" || ext === "mkv" ? ext : "mp4";
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const num = (n: number) => String(Math.round(n * 1000) / 1000);
const faststart = (f: string) => (f === "mp4" || f === "mov" ? ["-movflags", "+faststart"] : []);

/** H.264/VP8 at the converter's default quality (CRF 23 / veryfast). */
const encodeVideo = (format: VideoOut) => videoCodec({ format, quality: 75 } as Pick<VideoOptions, "format" | "quality">);

/**
 * Audio for a job that only touches the picture: copied untouched when the container
 * doesn't change (fast, lossless), re-encoded otherwise. No audio stream → nothing.
 */
function keepAudio(info: MediaInfo, format: VideoOut, sameContainer: boolean): string[] {
  if (!info.audio) return ["-an"];
  return sameContainer ? ["-c:a", "copy"] : audioCodec(format, 160);
}

export interface Size {
  width: number;
  height: number;
}

// ---------------------------------------------------------------- resize

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export type Fit = "crop" | "pad" | "blur";

export const RESIZE_PRESETS = [2160, 1440, 1080, 720, 480, 360] as const;
export const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "4:5"];

export type ResizeOptions =
  /** Short side in px (portrait 1080p = 1080×1920), aspect kept, upscaling allowed. */
  | { mode: "preset"; short: number }
  /** Either side may be null (derived); with keepAspect both sides form a box the video fits inside. */
  | { mode: "custom"; width: number | null; height: number | null; keepAspect: boolean }
  /** Social frame: `short` px on the short side (null = the video's own short side). */
  | { mode: "aspect"; aspect: Aspect; short: number | null; fit: Fit; color: string };

/** Output frame size (even numbers, as H.264 4:2:0 requires). */
export function resizeTarget(o: ResizeOptions, src: Size): Size {
  const { width: w, height: h } = src;
  switch (o.mode) {
    case "preset": {
      const k = o.short / Math.min(w, h);
      return { width: even(w * k), height: even(h * k) };
    }
    case "custom": {
      if (o.width && o.height && !o.keepAspect) return { width: even(o.width), height: even(o.height) };
      const k = Math.min(o.width ? o.width / w : Infinity, o.height ? o.height / h : Infinity);
      return Number.isFinite(k) ? { width: even(w * k), height: even(h * k) } : { width: even(w), height: even(h) };
    }
    case "aspect": {
      const [aw, ah] = o.aspect.split(":").map(Number);
      const short = o.short ?? Math.min(w, h);
      return aw >= ah ? { width: even((short * aw) / ah), height: even(short) } : { width: even(short), height: even((short * ah) / aw) };
    }
  }
}

const hex = (color: string) => `0x${/^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? "000000"}`;

/**
 * Video filter for a resize. Returns `{ vf }` for a plain chain or `{ complex }` for a
 * filter graph that ends in [v] (the blurred-background fill).
 */
export function resizeFilter(o: ResizeOptions, t: Size): { vf: string } | { complex: string } {
  const { width: W, height: H } = t;
  if (o.mode !== "aspect") return { vf: `scale=${W}:${H}:flags=bicubic,setsar=1` };
  if (o.fit === "crop") return { vf: `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1` };
  const fg = `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  if (o.fit === "pad") return { vf: `${fg},pad=${W}:${H}:-1:-1:color=${hex(o.color)},setsar=1` };
  // Blur at 1/8 size, then upscale: same look, a fraction of the work.
  const bw = even(W / 8);
  const bh = even(H / 8);
  const r = Math.max(1, Math.min(20, Math.floor(Math.min(bw, bh) / 8)));
  return {
    complex:
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=${r}:2,scale=${W}:${H},setsar=1[b];` +
      `[fg]${fg},setsar=1[f];[b][f]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`,
  };
}

export interface Job {
  input: string;
  output: string;
  info: MediaInfo;
  /** Input container extension, e.g. "mp4". */
  ext: string;
}

export function resizeArgs(o: ResizeOptions, { input, output, info, ext }: Job): string[] {
  if (!info.width || !info.height) throw new Error("Couldn't read the video size");
  const format = videoOut(ext);
  const f = resizeFilter(o, resizeTarget(o, { width: info.width, height: info.height }));
  return [
    "-i",
    input,
    ...("vf" in f ? ["-vf", f.vf, "-map", "0:v:0", "-map", "0:a:0?"] : ["-filter_complex", f.complex, "-map", "[v]", "-map", "0:a:0?"]),
    ...encodeVideo(format),
    ...keepAudio(info, format, format === ext),
    "-sn",
    "-dn",
    ...faststart(format),
    output,
  ];
}

// ---------------------------------------------------------------- speed / reverse

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** atempo factors (each within 0.5–2 for clean pitch-preserving audio) whose product is `speed`. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2) {
    out.push("atempo=2");
    s /= 2;
  }
  while (s < 0.5) {
    out.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${num(s)}`);
  return out;
}

export interface SpeedOptions {
  speed: number;
  /** false = drop the audio track */
  audio: boolean;
  reverse: boolean;
}

export function speedArgs(o: SpeedOptions, { input, output, info, ext }: Job): string[] {
  const format = videoOut(ext);
  const vf = [o.reverse ? "reverse" : null, o.speed !== 1 ? `setpts=PTS/${num(o.speed)}` : null, o.speed !== 1 && info.fps ? `fps=${num(info.fps)}` : null].filter(Boolean);
  const af = [o.reverse ? "areverse" : null, ...atempoChain(o.speed)].filter(Boolean);
  const audio = o.audio && info.audio;
  return [
    "-i",
    input,
    ...(vf.length ? ["-vf", vf.join(",")] : []),
    ...encodeVideo(format),
    ...(audio ? [...(af.length ? ["-af", af.join(",")] : []), ...audioCodec(format, 160)] : ["-an"]),
    "-sn",
    "-dn",
    ...faststart(format),
    output,
  ];
}

/** Raw frames `reverse` must hold in memory (it buffers the whole clip). */
export function reverseBytes(info: MediaInfo): number {
  if (!info.duration || !info.width || !info.height) return 0;
  return info.duration * (info.fps ?? 30) * info.width * info.height * 1.5;
}

/** Above this the 2 GB wasm heap runs out. */
export const REVERSE_LIMIT = 1.2e9;

/** Longest clip of this size/frame rate that can be reversed, in whole seconds. */
export function maxReverseSeconds(info: MediaInfo): number {
  const perSecond = reverseBytes({ ...info, duration: 1 });
  return perSecond ? Math.floor(REVERSE_LIMIT / perSecond) : Infinity;
}

// ---------------------------------------------------------------- rotate / flip

export interface RotateOptions {
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
}

const ROTATE: Record<Rotation, string | null> = { 0: null, 90: "transpose=1", 180: "hflip,vflip", 270: "transpose=2" };

/** Only rotating an MP4/MOV can be done by rewriting the display matrix (no re-encode). */
export function canRotateLossless(ext: string, o: RotateOptions): boolean {
  return ["mp4", "m4v", "mov"].includes(ext) && o.rotate !== 0 && !o.flipH && !o.flipV;
}

export function rotateArgs(o: RotateOptions, { input, output, info, ext }: Job): string[] {
  const format = videoOut(ext);
  const vf = [ROTATE[o.rotate], o.flipH ? "hflip" : null, o.flipV ? "vflip" : null].filter(Boolean);
  return [
    "-i",
    input,
    ...(vf.length ? ["-vf", vf.join(",")] : []),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...encodeVideo(format),
    ...keepAudio(info, format, format === ext),
    "-sn",
    "-dn",
    ...faststart(format),
    output,
  ];
}

// ---------------------------------------------------------------- merge

/** Can these clips be joined by stream copy (concat demuxer) without glitches? */
export function canConcatCopy(infos: MediaInfo[]): boolean {
  const [a, ...rest] = infos;
  if (!a?.video) return false;
  const fps = (i: MediaInfo) => Math.round((i.fps ?? 0) * 100);
  return rest.every(
    (b) =>
      b.video === a.video &&
      b.profile === a.profile &&
      b.pixFmt === a.pixFmt &&
      b.width === a.width &&
      b.height === a.height &&
      (b.rotation ?? 0) === (a.rotation ?? 0) &&
      fps(b) === fps(a) &&
      b.audio === a.audio &&
      b.sampleRate === a.sampleRate &&
      b.channels === a.channels,
  );
}

/** Container for a stream-copy join: the first clip's, or Matroska (holds anything). */
export function copyContainer(ext: string): VideoOut {
  return ext === "mp4" || ext === "m4v" ? "mp4" : ext === "mov" || ext === "webm" ? ext : "mkv";
}

export interface MergeTarget extends Size {
  fps: number;
}

/**
 * Common frame for a re-encoded join: the first clip's size (or `short` px on its short
 * side) and frame rate (or `fps`).
 */
export function mergeTarget(first: MediaInfo, short: number | null, fps: number | null): MergeTarget {
  const w = first.width ?? 1280;
  const h = first.height ?? 720;
  const k = short ? short / Math.min(w, h) : 1;
  return { width: even(w * k), height: even(h * k), fps: fps ?? (first.fps ? Math.min(60, first.fps) : 30) };
}

/**
 * One clip → H.264/AAC 48 kHz stereo at the common size (letterboxed) and frame rate.
 * A clip without sound gets silence, and audio is padded/cut to the picture so later
 * clips stay in sync after the join. Simple filtergraphs on purpose: ffmpeg 5.1 (the
 * wasm build) never finishes `apad` + `-shortest` inside a -filter_complex.
 */
export function normalizeArgs(t: MergeTarget, { input, output, info }: Omit<Job, "ext">): string[] {
  const vf = `scale=${t.width}:${t.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${t.width}:${t.height}:-1:-1:color=black,setsar=1,fps=${num(t.fps)},format=yuv420p`;
  const audio = info.audio
    ? ["-map", "0:v:0", "-map", "0:a:0", "-af", "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad"]
    : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a"];
  return [
    "-i",
    input,
    ...audio,
    "-vf",
    vf,
    "-shortest",
    ...encodeVideo("mp4"),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-video_track_timescale",
    "90000",
    "-sn",
    "-dn",
    output,
  ];
}

/** Concat demuxer list; paths are our own /in… mounts, quoted for safety anyway. */
export function concatList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export function concatArgs(list: string, output: string, format: VideoOut): string[] {
  return ["-f", "concat", "-safe", "0", "-i", list, "-map", "0:v", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero", ...faststart(format), output];
}

// ---------------------------------------------------------------- trim audio

const AUDIO_ALIAS: Record<string, AudioFormat> = { oga: "ogg", aif: "aiff", weba: "opus" };

/** "Same format" output for an audio input; formats ffmpeg can't write (WMA, AMR…) fall back to MP3. */
export function sameAudioFormat(ext: string): AudioFormat {
  return AUDIO_ALIAS[ext] ?? ((AUDIO_FORMATS as string[]).includes(ext) ? (ext as AudioFormat) : "mp3");
}
