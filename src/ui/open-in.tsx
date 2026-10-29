import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Search, Share2 } from "lucide-react";
import { normalize, toolsAccepting } from "../catalog";
import { extensionsOf, handOff } from "../lib/handoff";
import { useLang, useT } from "../lib/i18n";
import { navigate, slugFromPath, usePath } from "../lib/router";
import type { Output } from "../lib/use-queue";
import { ToolIcon } from "../icons";
import { Button } from "./kit";
import { ui } from "./strings";

/** "Continue with…": sends the outputs to another tool that accepts their file type. */
export function OpenIn({ outputs }: { outputs: Output[] }) {
  const t = useT(ui);
  const lang = useLang();
  const current = slugFromPath(usePath());
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const exts = useMemo(() => extensionsOf(outputs), [outputs]);
  const tools = useMemo(() => toolsAccepting(exts).filter((x) => x.slug !== current), [exts, current]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!tools.length) return null;
  const words = normalize(q).split(/\s+/).filter(Boolean);
  const shown = words.length ? tools.filter((x) => words.every((w) => normalize(`${x.name[lang]} ${x.name.en} ${x.slug}`).includes(w))) : tools;

  const go = (slug: string) => {
    handOff(
      slug,
      outputs.map((o) => new File([o.blob], o.name, { type: o.blob.type })),
    );
    setOpen(false);
    navigate(`/${slug}`);
  };

  return (
    <div ref={box} className="relative">
      <Button onClick={() => setOpen((v) => !v)} aria-expanded={open} title={t("continueHint")} data-testid="continue-with">
        <Share2 className="size-4" />
        {t("continueWith")}
      </Button>
      {open ? (
        <div className="absolute top-full right-0 z-20 mt-2 flex w-[min(320px,calc(100vw-2rem))] animate-rise flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)]">
          {tools.length > 6 ? (
            <label className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search className="size-3.5 shrink-0 text-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("filterTools")}
                aria-label={t("filterTools")}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80"
              />
            </label>
          ) : null}
          <ul className="max-h-80 overflow-y-auto p-1">
            {shown.map((x) => (
              <li key={x.slug}>
                <button
                  type="button"
                  onClick={() => go(x.slug)}
                  className="group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
                >
                  <ToolIcon slug={x.slug} group={x.group} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{x.name[lang]}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
