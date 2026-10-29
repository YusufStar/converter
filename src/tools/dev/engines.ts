import { lazyEngine } from "../../lib/lazy-engine";
import { Barcode, Captions, Dices, FingerprintPattern, KeyRound, QrCode, ScanLine } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "dev-hash": lazyEngine(() => import("./hash-tool")),
  "dev-uuid": lazyEngine(() => import("./uuid-tool")),
  "dev-jwt": lazyEngine(() => import("./jwt-tool")),
  "dev-qr": lazyEngine(() => import("./qr-tool")),
  "dev-barcode": lazyEngine(() => import("./barcode-tool")),
  "dev-scanner": lazyEngine(() => import("./scanner-tool")),
  "dev-subtitle": lazyEngine(() => import("./subtitle-tool")),
};

export const icons: IconMap = {
  "hash-generator": FingerprintPattern,
  "uuid-generator": Dices,
  "jwt-decoder": KeyRound,
  "qr-code-generator": QrCode,
  "barcode-generator": Barcode,
  "qr-code-scanner": ScanLine,
  "subtitle-converter": Captions,
  "srt-to-vtt": Captions,
  "vtt-to-srt": Captions,
};
