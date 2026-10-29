import { describe, expect, it } from "vitest";
import type { MediaInfo } from "../media/args";
import {
  atempoChain,
  canConcatCopy,
  canRotateLossless,
  concatArgs,
  concatList,
  copyContainer,
  maxReverseSeconds,
  mergeTarget,
  normalizeArgs,
  resizeArgs,
  resizeFilter,
  resizeTarget,
  reverseBytes,
  rotateArgs,
  sameAudioFormat,
  speedArgs,
  videoOut,
} from "./args";

const info: MediaInfo = { duration: 10, width: 1920, height: 1080, fps: 30, video: "h264", profile: "High", pixFmt: "yuv420p", audio: "aac", sampleRate: 48000, channels: "stereo" };
const job = { input: "/in1/0.mp4", output: "/out1/output.mp4", info, ext: "mp4" };
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("videoOut", () => {
  it("keeps modern containers, else MP4", () => {
    expect(["mp4", "webm", "mov", "mkv", "avi", "m4v", "3gp"].map(videoOut)).toEqual(["mp4", "webm", "mov", "mkv", "mp4", "mp4", "mp4"]);
  });
});

describe("resizeTarget", () => {
  const land = { width: 1920, height: 1080 };
  const port = { width: 1080, height: 1920 };
  it("presets set the short side and may upscale", () => {
    expect(resizeTarget({ mode: "preset", short: 720 }, land)).toEqual({ width: 1280, height: 720 });
    expect(resizeTarget({ mode: "preset", short: 720 }, port)).toEqual({ width: 720, height: 1280 });
    expect(resizeTarget({ mode: "preset", short: 2160 }, land)).toEqual({ width: 3840, height: 2160 });
    expect(resizeTarget({ mode: "preset", short: 480 }, { width: 640, height: 360 })).toEqual({ width: 854, height: 480 });
  });

  it("custom sizes: one side derived, box fit or stretch, always even", () => {
    expect(resizeTarget({ mode: "custom", width: 1000, height: null, keepAspect: true }, land)).toEqual({ width: 1000, height: 562 });
    expect(resizeTarget({ mode: "custom", width: 1000, height: 1000, keepAspect: true }, land)).toEqual({ width: 1000, height: 562 });
    expect(resizeTarget({ mode: "custom", width: 801, height: 601, keepAspect: false }, land)).toEqual({ width: 802, height: 602 });
    expect(resizeTarget({ mode: "custom", width: null, height: null, keepAspect: true }, land)).toEqual(land);
  });

  it("social frames use the short side", () => {
    const o = (aspect: "16:9" | "9:16" | "1:1" | "4:5", short: number | null) => ({ mode: "aspect" as const, aspect, short, fit: "crop" as const, color: "#000000" });
    expect(resizeTarget(o("9:16", 1080), land)).toEqual({ width: 1080, height: 1920 });
    expect(resizeTarget(o("4:5", 1080), land)).toEqual({ width: 1080, height: 1350 });
    expect(resizeTarget(o("1:1", null), land)).toEqual({ width: 1080, height: 1080 });
    expect(resizeTarget(o("16:9", 720), port)).toEqual({ width: 1280, height: 720 });
  });
});

describe("resizeFilter / resizeArgs", () => {
  const t = { width: 1080, height: 1920 };
  it("crop fills, pad letterboxes with the colour", () => {
    expect(resizeFilter({ mode: "aspect", aspect: "9:16", short: 1080, fit: "crop", color: "#000000" }, t)).toEqual({
      vf: "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
    });
    expect(resizeFilter({ mode: "aspect", aspect: "9:16", short: 1080, fit: "pad", color: "#FF8800" }, t)).toEqual({
      vf: "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:-1:-1:color=0xFF8800,setsar=1",
    });
  });

  it("blur builds a graph ending in [v] with a small blurred background", () => {
    const f = resizeFilter({ mode: "aspect", aspect: "9:16", short: 1080, fit: "blur", color: "#000000" }, t);
    expect("complex" in f && f.complex).toContain("scale=136:240:force_original_aspect_ratio=increase,crop=136:240,boxblur=17:2,scale=1080:1920");
    expect("complex" in f && f.complex.endsWith("[v]")).toBe(true);
    const args = resizeArgs({ mode: "aspect", aspect: "9:16", short: 1080, fit: "blur", color: "#000000" }, job);
    expect(after(args, "-map")).toBe("[v]");
  });

  it("copies audio when the container stays, re-encodes otherwise", () => {
    const same = resizeArgs({ mode: "preset", short: 720 }, job);
    expect(after(same, "-vf")).toBe("scale=1280:720:flags=bicubic,setsar=1");
    expect(after(same, "-c:a")).toBe("copy");
    expect(after(same, "-c:v")).toBe("libx264");
    const avi = resizeArgs({ mode: "preset", short: 720 }, { ...job, ext: "avi", output: "/out1/output.mp4" });
    expect(after(avi, "-c:a")).toBe("aac");
    const silent = resizeArgs({ mode: "preset", short: 720 }, { ...job, info: { ...info, audio: undefined } });
    expect(silent).toContain("-an");
  });

  it("needs the input size", () => {
    expect(() => resizeArgs({ mode: "preset", short: 720 }, { ...job, info: {} })).toThrow();
  });
});

describe("speed", () => {
  it("chains atempo within 0.5–2", () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(1.5)).toEqual(["atempo=1.5"]);
    expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
    expect(atempoChain(3)).toEqual(["atempo=2", "atempo=1.5"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(atempoChain(0.75)).toEqual(["atempo=0.75"]);
  });

  it("retimes video and audio", () => {
    const a = speedArgs({ speed: 2, audio: true, reverse: false }, job);
    expect(after(a, "-vf")).toBe("setpts=PTS/2,fps=30");
    expect(after(a, "-af")).toBe("atempo=2");
    expect(after(a, "-c:a")).toBe("aac");
  });

  it("reverses and drops audio", () => {
    const a = speedArgs({ speed: 1, audio: false, reverse: true }, { ...job, ext: "webm", output: "/out1/output.webm" });
    expect(after(a, "-vf")).toBe("reverse");
    expect(a).toContain("-an");
    expect(after(a, "-c:v")).toBe("libvpx");
    const b = speedArgs({ speed: 0.5, audio: true, reverse: true }, job);
    expect(after(b, "-af")).toBe("areverse,atempo=0.5");
  });

  it("estimates reverse memory", () => {
    expect(reverseBytes({ duration: 10, fps: 30, width: 1280, height: 720 })).toBe(10 * 30 * 1280 * 720 * 1.5);
    expect(maxReverseSeconds({ fps: 30, width: 1280, height: 720 })).toBe(28);
    expect(maxReverseSeconds({})).toBe(Infinity);
  });
});

describe("rotate", () => {
  it("lossless only for plain rotations of MP4/MOV", () => {
    expect(canRotateLossless("mp4", { rotate: 90, flipH: false, flipV: false })).toBe(true);
    expect(canRotateLossless("mov", { rotate: 180, flipH: false, flipV: false })).toBe(true);
    expect(canRotateLossless("mp4", { rotate: 90, flipH: true, flipV: false })).toBe(false);
    expect(canRotateLossless("mkv", { rotate: 90, flipH: false, flipV: false })).toBe(false);
    expect(canRotateLossless("mp4", { rotate: 0, flipH: false, flipV: false })).toBe(false);
  });

  it("builds transpose/flip chains", () => {
    expect(after(rotateArgs({ rotate: 90, flipH: false, flipV: false }, job), "-vf")).toBe("transpose=1");
    expect(after(rotateArgs({ rotate: 270, flipH: true, flipV: false }, job), "-vf")).toBe("transpose=2,hflip");
    expect(after(rotateArgs({ rotate: 0, flipH: false, flipV: true }, job), "-vf")).toBe("vflip");
    expect(after(rotateArgs({ rotate: 180, flipH: false, flipV: false }, job), "-c:a")).toBe("copy");
  });
});

describe("merge", () => {
  it("stream-copies only matching clips", () => {
    expect(canConcatCopy([info, { ...info }])).toBe(true);
    expect(canConcatCopy([info, { ...info, width: 1280 }])).toBe(false);
    expect(canConcatCopy([info, { ...info, audio: undefined, sampleRate: undefined, channels: undefined }])).toBe(false);
    expect(canConcatCopy([info, { ...info, fps: 25 }])).toBe(false);
    expect(canConcatCopy([info, { ...info, rotation: 90 }])).toBe(false);
    expect(canConcatCopy([{ audio: "aac" }, { audio: "aac" }])).toBe(false);
  });

  it("picks the copy container", () => {
    expect(["mp4", "m4v", "mov", "webm", "mkv", "ts"].map(copyContainer)).toEqual(["mp4", "mp4", "mov", "webm", "mkv", "mkv"]);
  });

  it("targets the first clip or a chosen size / frame rate", () => {
    expect(mergeTarget(info, null, null)).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(mergeTarget({ width: 1080, height: 1920, fps: 59.94 }, 720, null)).toEqual({ width: 720, height: 1280, fps: 59.94 });
    expect(mergeTarget({}, null, 25)).toEqual({ width: 1280, height: 720, fps: 25 });
  });

  it("normalises with letterbox, stereo 48k and silence for mute clips", () => {
    const t = { width: 1280, height: 720, fps: 30 };
    const a = normalizeArgs(t, job);
    expect(after(a, "-vf")).toBe("scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:-1:-1:color=black,setsar=1,fps=30,format=yuv420p");
    expect(after(a, "-af")).toBe("aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad");
    expect(a).toContain("-shortest");
    expect(a).not.toContain("-filter_complex"); // apad + -shortest never ends in a complex graph on ffmpeg 5.1
    const b = normalizeArgs(t, { ...job, info: { ...info, audio: undefined } });
    expect(b.slice(2, 10)).toEqual(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a"]);
  });

  it("writes a concat list and copy args", () => {
    expect(concatList(["/in1/0.mp4", "/in1/it's.mp4"])).toBe("file '/in1/0.mp4'\nfile '/in1/it'\\''s.mp4'\n");
    expect(concatArgs("/w/list.txt", "/out/o.mp4", "mp4")).toEqual([
      "-f", "concat", "-safe", "0", "-i", "/w/list.txt", "-map", "0:v", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "/out/o.mp4",
    ]);
  });
});

describe("sameAudioFormat", () => {
  it("keeps writable formats, maps aliases, falls back to MP3", () => {
    expect(["mp3", "wav", "m4a", "flac", "oga", "aif", "weba", "wma", "amr"].map(sameAudioFormat)).toEqual(["mp3", "wav", "m4a", "flac", "ogg", "aiff", "opus", "mp3", "mp3"]);
  });
});
