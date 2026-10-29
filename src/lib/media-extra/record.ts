// Small pure helpers for the recorders and the audio trimmer (unit-tested in Node).

/** Peak amplitude (0–1) per bucket across all channels — the bars of a waveform. */
export function peaks(channels: Float32Array[], buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets));
  const len = channels[0]?.length ?? 0;
  if (!len || !buckets) return out;
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor((i * len) / buckets);
    const to = Math.max(from + 1, Math.floor(((i + 1) * len) / buckets));
    let max = 0;
    for (const ch of channels) for (let j = from; j < to && j < len; j++) max = Math.max(max, Math.abs(ch[j]));
    out[i] = Math.min(1, max);
  }
  return out;
}

/** RMS of a block → 0–1 meter level on a -60…0 dBFS scale. */
export function meterLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-9);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

const VIDEO_TYPES: [string, string][] = [
  ["video/webm;codecs=vp9,opus", "webm"],
  ["video/webm;codecs=vp8,opus", "webm"],
  ["video/webm", "webm"],
  ["video/mp4", "mp4"],
];
const AUDIO_TYPES: [string, string][] = [
  ["audio/webm;codecs=opus", "webm"],
  ["audio/ogg;codecs=opus", "ogg"],
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
];

/** First MediaRecorder type the browser supports (WebM in Chrome/Firefox, MP4 in Safari). */
export function recorderType(kind: "video" | "audio", supported: (type: string) => boolean): { mime: string; ext: string } | null {
  const hit = (kind === "video" ? VIDEO_TYPES : AUDIO_TYPES).find(([t]) => supported(t));
  return hit ? { mime: hit[0], ext: hit[1] } : null;
}

/** "Screen recording 2026-10-29 18.40.12" — local time, safe in every file system. */
export function stampName(prefix: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

/** 65.4 → "01:05", 3725 → "1:02:05" (a recording clock). */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}
