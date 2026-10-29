import { lazyEngine } from "../../lib/lazy-engine";
import { AudioWaveform, Combine, Gauge, Mic, MonitorPlay, Proportions, RotateCw } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "media-resize": lazyEngine(() => import("./resize-tool")),
  "media-speed": lazyEngine(() => import("./speed-tool")),
  "media-rotate": lazyEngine(() => import("./rotate-tool")),
  "media-merge": lazyEngine(() => import("./merge-tool")),
  "media-trim-audio": lazyEngine(() => import("./trim-audio-tool")),
  "media-screen-recorder": lazyEngine(() => import("./screen-recorder-tool")),
  "media-voice-recorder": lazyEngine(() => import("./voice-recorder-tool")),
};

export const icons: IconMap = {
  "resize-video": Proportions,
  "video-speed": Gauge,
  "rotate-video": RotateCw,
  "merge-videos": Combine,
  "trim-audio": AudioWaveform,
  "screen-recorder": MonitorPlay,
  "voice-recorder": Mic,
};
