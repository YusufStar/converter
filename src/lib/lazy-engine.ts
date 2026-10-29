import { lazy, type ComponentType } from "react";
import type { Engine, EngineProps } from "../engines";

/** `lazy()` that can also be started early (on link hover) with `.preload()`. */
export function lazyEngine(load: () => Promise<{ default: ComponentType<EngineProps> }>): Engine {
  return Object.assign(lazy(load), { preload: load });
}
