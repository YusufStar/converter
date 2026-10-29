import { lazyEngine } from "../../lib/lazy-engine";
import { FormInput, LockKeyhole, LockKeyholeOpen, Signature } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "pdf-sign": lazyEngine(() => import("./sign-tool")),
  "pdf-form": lazyEngine(() => import("./form-tool")),
  "pdf-protect": lazyEngine(() => import("./protect-tool")),
  "pdf-unlock": lazyEngine(() => import("./unlock-tool")),
};

export const icons: IconMap = {
  "sign-pdf": Signature,
  "fill-pdf-form": FormInput,
  "protect-pdf": LockKeyhole,
  "unlock-pdf": LockKeyholeOpen,
};
