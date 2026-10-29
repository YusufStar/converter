import { lazyEngine } from "../../lib/lazy-engine";
import { AudioLines, Clapperboard, FileAudio, FileVideo, GalleryHorizontalEnd, ImagePlay, Music, Scissors, Shrink, VolumeX } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "media-video": lazyEngine(() => import("./video-tool")),
  "media-audio": lazyEngine(() => import("./audio-tool")),
  "media-trim": lazyEngine(() => import("./trim-tool")),
  "media-frames": lazyEngine(() => import("./frames-tool")),
};

export const icons: IconMap = {
  "video-converter": Clapperboard,
  "video-compressor": Shrink,
  "video-to-gif": ImagePlay,
  "video-to-mp3": Music,
  "audio-converter": AudioLines,
  "trim-video": Scissors,
  "mute-video": VolumeX,
  "video-to-frames": GalleryHorizontalEnd,
  "mp4-to-mp3": Music,
  "wav-to-mp3": FileAudio,
  "m4a-to-mp3": FileAudio,
  "mov-to-mp4": FileVideo,
  "webm-to-mp4": FileVideo,
  "mkv-to-mp4": FileVideo,
};
