import { useSyncExternalStore } from "react";
import { handOff } from "./handoff";
import { navigate } from "./router";

// Installable app: service worker (offline), install prompt, and "Open with" from the OS
// (manifest file_handlers → launchQueue). Files opened that way land on the home page, which
// lists the tools that can take them.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface LaunchParams {
  files: FileSystemFileHandle[];
}

declare global {
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
  }
}

export const LAUNCH_EVENT = "converter:launch-files";

let installEvent: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function initPwa() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline support is a bonus; the app works without it.
      });
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    notify();
  });

  window.launchQueue?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    const list = await Promise.all(files.map((handle) => handle.getFile()));
    handOff("", list);
    navigate("/");
    window.dispatchEvent(new Event(LAUNCH_EVENT));
  });
}

/** A function that shows the browser's install dialog, or null when the app can't be installed. */
export function useInstall(): (() => void) | null {
  const available = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => installEvent !== null,
    () => false,
  );
  if (!available) return null;
  return () => {
    const e = installEvent;
    if (!e) return;
    void e.prompt().finally(() => {
      installEvent = null;
      notify();
    });
  };
}
