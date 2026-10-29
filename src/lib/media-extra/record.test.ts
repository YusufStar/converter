import { describe, expect, it } from "vitest";
import { clock, meterLevel, peaks, recorderType, stampName } from "./record";

describe("peaks", () => {
  it("takes the loudest sample per bucket across channels", () => {
    const l = new Float32Array([0.1, -0.5, 0.2, 0.0, 0.9, -0.1]);
    const r = new Float32Array([0.3, 0.0, -0.7, 0.0, 0.0, 0.0]);
    expect(Array.from(peaks([l, r], 3)).map((x) => +x.toFixed(2))).toEqual([0.5, 0.7, 0.9]);
  });

  it("handles more buckets than samples and empty input", () => {
    expect(peaks([new Float32Array([0.5])], 4).length).toBe(4);
    expect(peaks([], 10).every((x) => x === 0)).toBe(true);
  });
});

describe("meterLevel", () => {
  it("maps silence to 0 and full scale to 1", () => {
    expect(meterLevel(new Float32Array(128))).toBe(0);
    expect(meterLevel(new Float32Array(128).fill(1))).toBe(1);
    expect(meterLevel(new Float32Array(128).fill(0.01))).toBeCloseTo(1 / 3, 2); // -40 dBFS
  });
});

describe("recorderType", () => {
  it("prefers WebM, falls back to MP4 (Safari)", () => {
    expect(recorderType("video", () => true)).toEqual({ mime: "video/webm;codecs=vp9,opus", ext: "webm" });
    expect(recorderType("audio", (t) => t === "audio/mp4")).toEqual({ mime: "audio/mp4", ext: "m4a" });
    expect(recorderType("video", () => false)).toBeNull();
  });
});

describe("names and clocks", () => {
  it("stamps a file-system-safe local time", () => {
    expect(stampName("Voice", new Date(2026, 0, 2, 3, 4, 5))).toBe("Voice 2026-01-02 03.04.05");
  });

  it("formats a recording clock", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(65.9)).toBe("01:05");
    expect(clock(3725)).toBe("1:02:05");
  });
});
