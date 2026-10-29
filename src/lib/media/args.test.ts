import { describe, expect, it } from "vitest";
import {
  audioArgs,
  audioFilters,
  clipLength,
  failureMessage,
  fitSize,
  threadCount,
  withThreads,
  formatTime,
  frameExt,
  framesArgs,
  gifArgs,
  isAudioFile,
  mpeg4Q,
  muteArgs,
  outputSize,
  parseInfo,
  parseRange,
  parseTime,
  sameContainer,
  targetVideoKbps,
  trimArgs,
  videoArgs,
  vp8Crf,
  x264Crf,
  type AudioOptions,
  type MediaInfo,
  type VideoOptions,
} from "./args";

const MP4_LOG = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/in1/input.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:01:05.50, start: 0.000000, bitrate: 108 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 104 kb/s, 29.97 fps, 30 tbr, 12800 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 64 kb/s (default)
At least one output file must be specified`;

const info: MediaInfo = { duration: 10, width: 1920, height: 1080, video: "h264", audio: "aac", sampleRate: 44100 };
const io = { input: "/in1/input.mp4", output: "/out1/output.mp4", info };

describe("parseTime", () => {
  it.each([
    ["65", 65],
    ["1:05", 65],
    ["00:01:05.5", 65.5],
    ["1:02:05", 3725],
    ["2.5", 2.5],
    ["0:01,5", 1.5],
    [" 7 ", 7],
  ])("%s → %d", (text, sec) => expect(parseTime(text)).toBe(sec));

  it("empty is null, garbage is NaN", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime("   ")).toBeNull();
    expect(parseTime("abc")).toBeNaN();
    expect(parseTime("1:75")).toBeNaN();
    expect(parseTime("-3")).toBeNaN();
    expect(parseTime("1:2:3:4")).toBeNaN();
  });
});

describe("formatTime", () => {
  it.each([
    [2, "0:02"],
    [65.5, "1:05.5"],
    [3725, "1:02:05"],
    [59.96, "1:00"],
    [-1, "0:00"],
  ])("%d → %s", (sec, text) => expect(formatTime(sec)).toBe(text));

  it("round-trips through parseTime", () => expect(parseTime(formatTime(125.4))).toBe(125.4));
});

describe("parseRange", () => {
  it("parses start/end and flags errors", () => {
    expect(parseRange("", "")).toEqual({ start: null, end: null });
    expect(parseRange("1:00", "1:30")).toEqual({ start: 60, end: 90 });
    expect(parseRange("", "5")).toEqual({ start: null, end: 5 });
    expect(parseRange("x", "5").error).toBe("invalid");
    expect(parseRange("10", "5").error).toBe("order");
    expect(parseRange("", "0").error).toBe("order");
  });
  it("length mode adds the duration to the start", () => {
    expect(parseRange("2", "3", true)).toEqual({ start: 2, end: 5 });
    expect(parseRange("", "3", true)).toEqual({ start: null, end: 3 });
    expect(parseRange("2", "0", true).error).toBe("order");
  });
});

describe("clipLength", () => {
  it("cuts to start/end and clamps to the duration", () => {
    expect(clipLength(10, null, null)).toBe(10);
    expect(clipLength(10, 2, null)).toBe(8);
    expect(clipLength(10, 2, 5)).toBe(3);
    expect(clipLength(10, 2, 50)).toBe(8);
    expect(clipLength(undefined, 2, 5)).toBe(3);
    expect(clipLength(undefined, 2, null)).toBeUndefined();
  });
});

describe("parseInfo", () => {
  it("reads duration, size, fps and codecs", () => {
    expect(parseInfo(MP4_LOG)).toEqual({
      duration: 65.5,
      width: 1920,
      height: 1080,
      fps: 29.97,
      video: "h264",
      profile: "High",
      pixFmt: "yuv420p",
      audio: "aac",
      sampleRate: 44100,
      channels: "mono",
    });
  });

  it("swaps size for 90° rotation metadata", () => {
    const log = MP4_LOG.replace("(default)\n", "(default)\n      Side data:\n        displaymatrix: rotation of -90.00 degrees\n");
    expect(parseInfo(log)).toMatchObject({ width: 1080, height: 1920, rotation: 90 });
    expect(parseInfo(log.replace("-90.00", "180.00"))).toMatchObject({ width: 1920, height: 1080, rotation: 180 });
  });

  it("ignores MP3 cover art and handles audio-only files", () => {
    const log = `Input #0, mp3, from 'a.mp3':
  Duration: 00:03:20.04, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 48000 Hz, stereo, fltp, 320 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)`;
    expect(parseInfo(log)).toEqual({ duration: 200.04, audio: "mp3", sampleRate: 48000, channels: "stereo" });
  });

  it("returns nothing for non-media", () => {
    expect(parseInfo("/in1/input.txt: Invalid data found when processing input")).toEqual({});
  });
});

describe("failureMessage", () => {
  it("keeps the last meaningful lines", () => {
    const lines = [
      "Input #0, mov,mp4 from 'x':",
      "  Stream #0:0 -> #0:0 (h264 (native) -> libx264 (libx264))",
      "[libx264 @ 0x1] width not divisible by 2 (321x240)",
      "Error initializing output stream 0:0 -- Error while opening encoder",
      "frame=    0 fps=0.0 q=0.0 Lsize=       0kB time=00:00:00.00",
      "Conversion failed!",
    ];
    expect(failureMessage(lines)).toBe("[libx264 @ 0x1] width not divisible by 2 (321x240) · Error initializing output stream 0:0 -- Error while opening encoder");
  });
  it("has a fallback", () => expect(failureMessage(["", "Conversion failed!"])).toBe("FFmpeg failed"));
});

describe("sizes", () => {
  it("fits the short side, keeps aspect, makes sizes even", () => {
    expect(fitSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(fitSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(fitSize(1920, 1080, 480)).toEqual({ width: 854, height: 480 });
    expect(fitSize(640, 480, 1080)).toEqual({ width: 640, height: 480 }); // never upscales
    expect(fitSize(321, 241, null)).toEqual({ width: 322, height: 242 });
    expect(fitSize(3, 1, 1)).toEqual({ width: 4, height: 2 }); // never below 2
  });

  it("outputSize applies scale and rotation", () => {
    expect(outputSize(info, 720, 90)).toEqual({ width: 720, height: 1280 });
    expect(outputSize(info, null, 180)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize({}, 720, 0)).toBeNull();
  });

  it("computes a bitrate for a target size", () => {
    // 10 MiB over 60 s = 1398 kbit/s total, minus 5% overhead and 96k audio.
    expect(targetVideoKbps(10, 60, 96)).toBe(1232);
    expect(targetVideoKbps(1, 3600, 128)).toBe(32); // floor
  });
});

describe("quality mapping", () => {
  it("maps 0–100 to codec scales, higher quality = lower number", () => {
    expect(x264Crf(75)).toBe(23);
    expect(x264Crf(100)).toBe(18);
    expect(x264Crf(0)).toBe(38);
    expect(vp8Crf(100)).toBe(6);
    expect(vp8Crf(0)).toBe(46);
    expect(mpeg4Q(100)).toBe(2);
    expect(mpeg4Q(0)).toBe(18);
  });
});

const video: VideoOptions = { format: "mp4", height: null, quality: 75, audioKbps: 128, fps: null, start: null, end: null, mute: false, rotate: 0 };

describe("videoArgs", () => {
  it("mp4: H.264 veryfast + AAC + faststart", () => {
    expect(videoArgs(video, io)).toEqual([
      "-i", "/in1/input.mp4",
      "-vf", "scale=1920:1080",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-sn", "-dn",
      "-movflags", "+faststart",
      "/out1/output.mp4",
    ]);
  });

  it("webm: VP8 realtime + Opus", () => {
    const a = videoArgs({ ...video, format: "webm" }, { ...io, output: "/o.webm" });
    expect(a).toContain("libvpx");
    expect(a.join(" ")).toContain("-deadline realtime -cpu-used 8 -crf 16 -b:v 20M");
    expect(a.join(" ")).toContain("-c:a libopus");
    expect(a).not.toContain("-movflags");
  });

  it("avi: MPEG-4 + MP3; mkv: no faststart; mov: faststart", () => {
    expect(videoArgs({ ...video, format: "avi" }, io).join(" ")).toContain("-c:v mpeg4 -vtag xvid -q:v 6 -c:a libmp3lame");
    expect(videoArgs({ ...video, format: "mkv" }, io)).not.toContain("-movflags");
    expect(videoArgs({ ...video, format: "mov" }, io)).toContain("-movflags");
  });

  it("resolution, fps, rotation, trim and mute", () => {
    const a = videoArgs({ ...video, height: 720, fps: 30, rotate: 90, start: 1.5, end: 4, mute: true }, io);
    expect(a.slice(0, 6)).toEqual(["-ss", "1.5", "-i", "/in1/input.mp4", "-t", "2.5"]);
    expect(a).toContain("scale=1280:720,fps=30,transpose=1");
    expect(a).toContain("-an");
    expect(a).not.toContain("-c:a");
  });

  it("unknown size still forces even dimensions", () => {
    expect(videoArgs(video, { ...io, info: {} })).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2");
    expect(videoArgs({ ...video, height: 480 }, { ...io, info: {} })).toContain("scale=-2:'min(480,ih)'");
  });

  it("target bitrate replaces CRF", () => {
    const a = videoArgs({ ...video, videoKbps: 1000 }, io).join(" ");
    expect(a).toContain("-b:v 1000k -maxrate 1500k -bufsize 2000k");
    expect(a).not.toContain("-crf");
  });
});

describe("gifArgs", () => {
  const gif = { fps: 15, width: 480, loop: true, hq: true, start: 1, end: 4, rotate: 0 as const };
  it("builds a palettegen/paletteuse graph", () => {
    expect(gifArgs(gif, { ...io, output: "/o.gif" })).toEqual([
      "-ss", "1", "-i", "/in1/input.mp4", "-t", "3",
      "-vf", "fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
      "-loop", "0", "-an", "/o.gif",
    ]);
  });
  it("simple palette, no loop, never upscales", () => {
    const a = gifArgs({ ...gif, hq: false, loop: false, width: 4000, start: null, end: null }, { ...io, output: "/o.gif" });
    expect(a).toEqual(["-i", "/in1/input.mp4", "-vf", "fps=15,scale=1920:-1:flags=lanczos", "-loop", "-1", "-an", "/o.gif"]);
  });
});

describe("trim / mute", () => {
  it("keeps the container when ffmpeg can write it", () => {
    expect(sameContainer("mov", false)).toBe("mov");
    expect(sameContainer("ts", false)).toBe("ts");
    expect(sameContainer("ts", true)).toBe("mkv");
    expect(sameContainer("mts", false)).toBe("mkv");
  });
  it("fast trim stream-copies", () => {
    expect(trimArgs({ start: 2, end: 5, precise: false, ext: "mp4" }, io)).toEqual([
      "-ss", "2", "-i", "/in1/input.mp4", "-t", "3", "-c", "copy", "-avoid_negative_ts", "make_zero", "-sn", "-dn", "/out1/output.mp4",
    ]);
  });
  it("precise trim re-encodes with the container's codecs", () => {
    expect(trimArgs({ start: 2, end: null, precise: true, ext: "mp4" }, io).join(" ")).toContain("-c:v libx264");
    expect(trimArgs({ start: 2, end: null, precise: true, ext: "webm" }, io).join(" ")).toContain("-c:v libvpx");
    expect(trimArgs({ start: 2, end: null, precise: true, ext: "ts" }, io).join(" ")).toContain("-movflags +faststart");
  });
  it("mute copies video and drops audio", () => {
    expect(muteArgs(io)).toEqual(["-i", "/in1/input.mp4", "-c", "copy", "-an", "-sn", "-dn", "/out1/output.mp4"]);
  });
});

const audio: AudioOptions = { format: "mp3", kbps: 192, sampleRate: null, channels: null, start: null, end: null, volume: 100, normalize: false, fadeIn: 0, fadeOut: 0 };

describe("audioArgs", () => {
  const aio = { input: "/in1/input.wav", output: "/out1/output.mp3", info };
  it("mp3 with bitrate", () => {
    expect(audioArgs(audio, aio)).toEqual(["-i", "/in1/input.wav", "-vn", "-sn", "-dn", "-c:a", "libmp3lame", "-b:a", "192k", "/out1/output.mp3"]);
  });
  it("lossless formats skip bitrate", () => {
    expect(audioArgs({ ...audio, format: "flac" }, aio)).not.toContain("-b:a");
    expect(audioArgs({ ...audio, format: "wav" }, aio)).toContain("pcm_s16le");
    expect(audioArgs({ ...audio, format: "aiff" }, aio)).toContain("pcm_s16be");
  });
  it("codecs per format", () => {
    expect(audioArgs({ ...audio, format: "ogg" }, aio)).toContain("libvorbis");
    expect(audioArgs({ ...audio, format: "opus" }, aio)).toContain("libopus");
    expect(audioArgs({ ...audio, format: "m4a" }, aio).join(" ")).toContain("-c:a aac -b:a 192k -movflags +faststart");
  });
  it("sample rate, channels, trim", () => {
    const a = audioArgs({ ...audio, sampleRate: 48000, channels: 1, start: 1, end: 3 }, aio).join(" ");
    expect(a).toContain("-ss 1 -i /in1/input.wav -t 2");
    expect(a).toContain("-ar 48000 -ac 1");
  });
  it("normalize restores the source rate; opus never forces a rate", () => {
    expect(audioArgs({ ...audio, normalize: true }, aio).join(" ")).toContain("-af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a libmp3lame -b:a 192k -ar 44100");
    expect(audioArgs({ ...audio, format: "opus", normalize: true, sampleRate: 44100 }, aio)).not.toContain("-ar");
  });
  it("volume and fades", () => {
    expect(audioFilters({ ...audio, volume: 150, fadeIn: 2, fadeOut: 3 }, 10)).toEqual(["volume=1.50", "afade=t=in:st=0:d=2", "afade=t=out:st=7:d=3"]);
    expect(audioFilters({ ...audio, volume: 150, normalize: true }, 10)).toEqual(["loudnorm=I=-16:TP=-1.5:LRA=11"]);
    expect(audioFilters({ ...audio, fadeOut: 3 }, undefined)).toEqual([]);
    // fade-out position follows the trimmed length
    expect(audioArgs({ ...audio, fadeOut: 1, start: 2, end: 6 }, aio).join(" ")).toContain("afade=t=out:st=3:d=1");
  });
});

describe("framesArgs", () => {
  it("one image every N seconds", () => {
    expect(framesArgs({ every: 2, format: "jpg", width: 640, start: null, end: null }, { ...io, output: "/out1/%04d.png" })).toEqual([
      "-i", "/in1/input.mp4", "-vf", "fps=1/2,scale=640:-2:flags=lanczos", "-frames:v", "1000", "-an", "/out1/%04d.png",
    ]);
    expect(frameExt("jpg")).toBe("png"); // mjpeg crashes in wasm, the browser makes the JPG
    expect(frameExt("webp")).toBe("webp");
    expect(framesArgs({ every: 1, format: "webp", width: null, start: null, end: null }, io)).toContain("libwebp");
  });
});

describe("isAudioFile", () => {
  it("uses type or extension", () => {
    expect(isAudioFile({ name: "a.flac", type: "" })).toBe(true);
    expect(isAudioFile({ name: "a.bin", type: "audio/x-foo" })).toBe(true);
    expect(isAudioFile({ name: "a.mp4", type: "video/mp4" })).toBe(false);
  });
});

describe("withThreads", () => {
  it("pins decoder, encoder and filter pools", () => {
    expect(withThreads(["-ss", "1", "-i", "/in/a.mp4", "-c:v", "libx264", "/out/o.mp4"], 4)).toEqual([
      "-filter_threads", "2", "-filter_complex_threads", "2",
      "-ss", "1", "-threads", "4", "-i", "/in/a.mp4", "-c:v", "libx264", "-threads", "4", "/out/o.mp4",
    ]);
  });

  it("splits decoder threads across inputs", () => {
    const args = withThreads(["-i", "a", "-i", "b", "-i", "c", "out.mp4"], 4);
    expect(args.filter((_, i) => args[i + 1] === "-i").length).toBe(3);
    expect(args.slice(4, 7)).toEqual(["-threads", "1", "-i"]);
  });

  it("caps the per-pool thread count", () => {
    expect(threadCount(32)).toBe(4);
    expect(threadCount(2)).toBe(2);
    expect(threadCount(undefined)).toBe(4);
  });
});
