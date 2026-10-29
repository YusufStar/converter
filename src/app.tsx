import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock, FolderInput, Languages, Loader2, Menu, MonitorDown, Moon, Search, ShieldCheck, Star, Sun, X } from "lucide-react";
import { GROUPS, TOOLS, searchTools, toolBySlug, toolsAccepting, type GroupId, type ToolMeta } from "./catalog";
import { ENGINES, preloadEngine } from "./engines";
import { GROUP_HUE, ToolIcon } from "./icons";
import { setLang, useLang, useT } from "./lib/i18n";
import { LANGS, LANG_NAMES } from "./lib/langs";
import { slugFromPath, usePath } from "./lib/router";
import { setTheme, useTheme } from "./lib/theme";
import { extensionsOf, handOff, takeHandoff } from "./lib/handoff";
import { markRecent, useFavorites, useRecent } from "./lib/prefs";
import { LAUNCH_EVENT, useInstall } from "./lib/pwa";
import { formatBytes } from "./lib/files";
import { Button, FormatChip, IconButton, cx } from "./ui/kit";
import { Link } from "./ui/link";
import { ui } from "./ui/strings";

export { Link };

const prefetchTool = (tool: ToolMeta) => () => preloadEngine(tool.engine);

function Logo() {
  const t = useT(ui);
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#ff6b2c" />
        <path d="M9 12.5h12.5l-3.5-3.5M23 19.5H10.5l3.5 3.5" fill="none" stroke="#1a0f08" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">{t("appName")}</span>
    </Link>
  );
}

function ThemeToggle() {
  const t = useT(ui);
  const theme = useTheme();
  const dark = theme === "dark";
  // The icon shows where a click goes.
  return (
    <IconButton label={dark ? t("toLight") : t("toDark")} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}

function InstallButton() {
  const t = useT(ui);
  const install = useInstall();
  if (!install) return null;
  return (
    <IconButton label={`${t("installApp")} — ${t("installHint")}`} title={t("installHint")} onClick={install}>
      <MonitorDown className="size-4" />
    </IconButton>
  );
}

/** Language picker: a short list of buttons (each name in its own language). */
function LangMenu() {
  const t = useT(ui);
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
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
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("language")}
        aria-expanded={open}
        title={t("language")}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted uppercase transition hover:bg-surface-2 hover:text-fg"
      >
        <Languages className="size-3.5" />
        {lang}
      </button>
      {open ? (
        <ul className="absolute right-0 bottom-full z-30 mb-2 flex w-40 animate-rise flex-col rounded-xl border border-line bg-surface p-1 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)]">
          {LANGS.map((l) => (
            <li key={l}>
              <button
                type="button"
                lang={l}
                aria-current={l === lang ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  if (l !== lang) setLang(l);
                }}
                className={cx(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2",
                  l === lang && "font-semibold",
                )}
              >
                {LANG_NAMES[l]}
                {l === lang ? <Check className="size-3.5 text-accent-text" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SidebarItem({ tool, active, onNavigate }: { tool: ToolMeta; active: boolean; onNavigate?: () => void }) {
  const lang = useLang();
  return (
    <li>
      <Link
        to={`/${tool.slug}`}
        onClick={onNavigate}
        prefetch={prefetchTool(tool)}
        aria-current={active ? "page" : undefined}
        className={cx(
          "group flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2 text-[13px] transition",
          active ? "bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-fg/80 hover:bg-surface-2 hover:text-fg",
        )}
      >
        <ToolIcon slug={tool.slug} group={tool.group} size="sm" />
        <span className="truncate">{tool.name[lang]}</span>
      </Link>
    </li>
  );
}

function Sidebar({ current, onNavigate }: { current: string; onNavigate?: () => void }) {
  const t = useT(ui);
  const lang = useLang();
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<Partial<Record<GroupId, boolean>>>({});

  // "/" focuses search from anywhere (except while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !target.closest("input, textarea, [contenteditable]")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const searching = q.trim().length > 0;
  // "X to Y" preset pages only show up when searching; the sidebar lists the main tools.
  const filtered = useMemo(() => (searching ? searchTools(q) : TOOLS.filter((x) => !x.parent)), [q, searching]);
  const favs = useFavorites()
    .map((s) => toolBySlug.get(s))
    .filter((x): x is ToolMeta => !!x);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-4 px-4 pt-5 pb-3">
        <Logo />
        <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80"
          />
          {searching ? (
            <button type="button" onClick={() => setQ("")} className="text-muted hover:text-fg" aria-label={t("clearAll")}>
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-muted">/</kbd>
          )}
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label={t("home")}>
        <Link
          to="/"
          onClick={onNavigate}
          aria-current={current === "" ? "page" : undefined}
          className={cx(
            "mb-2 flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition",
            current === "" ? "bg-surface text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          <span className="size-1.5 rounded-full bg-accent" />
          {t("home")}
        </Link>
        {searching && !filtered.length ? <p className="px-3 py-6 text-center text-xs text-muted">{t("noResults", { q })}</p> : null}
        {!searching && favs.length ? (
          <div className="mb-1" data-testid="sidebar-favorites">
            <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
              <Star className="size-3 fill-current text-accent-text" />
              <span className="flex-1">{t("favorites")}</span>
            </div>
            <ul className="flex flex-col gap-px">
              {favs.map((tool) => (
                <SidebarItem key={tool.slug} tool={tool} active={tool.slug === current} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ) : null}
        {GROUPS.map((g) => {
          const tools = filtered.filter((tool) => tool.group === g.id);
          if (!tools.length) return null;
          const open = searching || !collapsed[g.id];
          return (
            <div key={g.id} className="mb-1">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase hover:text-fg"
                aria-expanded={open}
              >
                <span className="size-1.5 rounded-full" style={{ background: GROUP_HUE[g.id] }} />
                <span className="flex-1 text-left">{g.name[lang]}</span>
                <span className="font-mono text-[10px] font-normal tracking-normal">{tools.length}</span>
                <ChevronDown className={cx("size-3.5 transition", !open && "-rotate-90")} />
              </button>
              {open ? (
                <ul className="flex flex-col gap-px">
                  {tools.map((tool) => (
                    <SidebarItem key={tool.slug} tool={tool} active={tool.slug === current} onNavigate={onNavigate} />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <ShieldCheck className="size-3.5 shrink-0 text-ok" />
          <span className="truncate">{t("privacy")}</span>
        </span>
        <div className="flex shrink-0 items-center">
          <InstallButton />
          <LangMenu />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function ToolCard({ tool, onOpen }: { tool: ToolMeta; onOpen?: () => void }) {
  const lang = useLang();
  return (
    <Link
      to={`/${tool.slug}`}
      onClick={onOpen}
      prefetch={prefetchTool(tool)}
      className="group flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition duration-200 ease-out-soft hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_12px_30px_-16px_rgb(0_0_0/0.25)]"
    >
      <div className="flex items-start gap-3">
        <ToolIcon slug={tool.slug} group={tool.group} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-semibold">{tool.name[lang]}</span>
          <span className="line-clamp-2 text-xs leading-relaxed text-muted">{tool.desc[lang]}</span>
        </div>
      </div>
      {tool.formats?.length ? (
        <div className="mt-auto flex flex-wrap gap-1">
          {tool.formats.slice(0, 6).map((f) => (
            <FormatChip key={f}>{f}</FormatChip>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

/** "Drop any file" on the home page: lists every tool that can open it and hands the file over. */
function useHomeFiles() {
  const [files, setFiles] = useState<File[]>([]);
  // Files the OS opened with the installed app arrive here (see src/lib/pwa.ts).
  useEffect(() => {
    const take = () => {
      const launched = takeHandoff("");
      if (launched.length) setFiles(launched);
    };
    take();
    window.addEventListener(LAUNCH_EVENT, take);
    return () => window.removeEventListener(LAUNCH_EVENT, take);
  }, []);
  return [files, setFiles] as const;
}

function HomeDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const t = useT(ui);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
      }}
      className="max-w-xl"
    >
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        data-testid="home-file-input"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cx(
          "flex w-full min-w-0 items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left transition",
          over ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent hover:bg-accent-soft/40",
        )}
      >
        <FolderInput className="size-5 shrink-0 text-accent-text" />
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">{t("homeDropTitle")}</span>
          <span className="text-xs text-muted">{t("homeDropBody")}</span>
        </span>
      </button>
    </div>
  );
}

function HomeDropResults({ files, onClear }: { files: File[]; onClear: () => void }) {
  const t = useT(ui);
  const tools = useMemo(() => toolsAccepting(extensionsOf(files)), [files]);
  return (
    <section className="flex flex-col gap-4" data-testid="home-drop-results" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 text-lg font-semibold tracking-tight break-all">
          {files.length === 1 ? t("homeDropResult", { name: files[0].name }) : t("homeDropResultMany", { n: files.length })}
        </h2>
        <Button size="sm" variant="ghost" onClick={onClear}>
          <X className="size-3.5" />
          {t("homeDropClear")}
        </Button>
      </div>
      {files.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {files.slice(0, 12).map((f, i) => (
            <span key={i} className="max-w-full truncate rounded-full border border-line px-2.5 py-1 text-xs text-muted">
              {f.name} · {formatBytes(f.size)}
            </span>
          ))}
        </div>
      ) : null}
      {tools.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} onOpen={() => handOff(tool.slug, files)} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">{t("homeDropNone")}</p>
      )}
    </section>
  );
}

function RecentTools() {
  const t = useT(ui);
  const lang = useLang();
  const recent = useRecent()
    .map((s) => toolBySlug.get(s))
    .filter((x): x is ToolMeta => !!x);
  if (!recent.length) return null;
  return (
    <section className="flex flex-col gap-3" data-testid="recent-tools">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
        <Clock className="size-4" />
        {t("recent")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {recent.map((tool) => (
          <Link
            key={tool.slug}
            to={`/${tool.slug}`}
            prefetch={prefetchTool(tool)}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-surface py-1.5 pr-3 pl-1.5 text-sm font-medium transition hover:border-accent"
          >
            <ToolIcon slug={tool.slug} group={tool.group} size="sm" />
            <span className="truncate">{tool.name[lang]}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Home() {
  const t = useT(ui);
  const lang = useLang();
  const [q, setQ] = useState("");
  const results = useMemo(() => searchTools(q), [q]);
  const popular = TOOLS.filter((x) => x.popular);
  const searching = q.trim().length > 0;
  const [files, setFiles] = useHomeFiles();

  return (
    <div className="flex flex-col gap-10">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-10 sm:px-10 sm:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 35%, transparent), transparent 70%)" }}
        />
        <div className="relative flex max-w-2xl flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1 text-xs font-medium text-muted">
            <ShieldCheck className="size-3.5 text-ok" />
            {t("privacy")}
          </span>
          <h1 className="text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] whitespace-pre-line sm:text-5xl">{t("heroTitle")}</h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted">{t("heroBody")}</p>
          <label className="flex h-12 max-w-xl items-center gap-3 rounded-xl border border-line bg-bg px-4 focus-within:border-accent">
            <Search className="size-[18px] text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/80"
            />
            <span className="hidden font-mono text-xs text-muted sm:inline">{t("toolsCount", { n: TOOLS.length })}</span>
          </label>
          {!searching && popular.length ? (
            <div className="flex flex-wrap gap-2">
              {popular.map((p) => (
                <Link
                  key={p.slug}
                  to={`/${p.slug}`}
                  prefetch={prefetchTool(p)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:bg-accent-soft"
                >
                  {p.name[lang]}
                </Link>
              ))}
            </div>
          ) : null}
          <HomeDropZone onFiles={setFiles} />
        </div>
      </section>

      {files.length ? <HomeDropResults files={files} onClear={() => setFiles([])} /> : null}
      {!searching && !files.length ? <RecentTools /> : null}

      {files.length ? null : searching ? (
        results.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {results.map((tool) => (
              <ToolCard key={tool.slug} tool={tool} />
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted">{t("noResults", { q })}</p>
        )
      ) : (
        GROUPS.map((g) => {
          const tools = TOOLS.filter((x) => x.group === g.id && !x.parent);
          if (!tools.length) return null;
          return (
            <section key={g.id} className="flex flex-col gap-4" id={g.id}>
              <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
                <span className="size-2 rounded-full" style={{ background: GROUP_HUE[g.id] }} />
                {g.name[lang]}
                <span className="font-mono text-xs font-normal text-muted">{tools.length}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {tools.map((tool) => (
                  <ToolCard key={tool.slug} tool={tool} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function NotFound() {
  const t = useT(ui);
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-lg font-semibold">{t("notFound")}</p>
      <Link to="/" className="text-sm font-medium text-accent-text underline-offset-4 hover:underline">
        {t("backHome")}
      </Link>
    </div>
  );
}

function Loading() {
  const t = useT(ui);
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" />
      {t("loadingEngine")}
    </div>
  );
}

function ToolRoute({ tool }: { tool: ToolMeta }) {
  const Engine = ENGINES[tool.engine];
  useEffect(() => markRecent(tool.slug), [tool.slug]);
  if (!Engine) return <NotFound />;
  // key: a fresh engine state per tool, so presets apply when switching tools.
  return (
    <Suspense fallback={<Loading />}>
      <Engine key={tool.slug} meta={tool} />
    </Suspense>
  );
}

const SITE_TITLE = "Converter";

export function App() {
  const t = useT(ui);
  const lang = useLang();
  const path = usePath();
  const slug = slugFromPath(path);
  const tool = slug ? toolBySlug.get(slug) : undefined;
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    document.title = tool ? `${tool.name[lang]} — ${SITE_TITLE}` : `${SITE_TITLE} — ${t("tagline")}`;
  }, [tool, lang, t]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Only English pages are for search engines (build/site.ts writes the same tags into each
  // page); keep that true after client-side navigation and for unknown paths.
  useEffect(() => {
    const indexable = lang === "en" && (!slug || !!tool);
    const setTag = (selector: string, create: () => HTMLElement, apply: (el: HTMLElement) => void) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      if (!el) document.head.append((el = create()));
      apply(el);
    };
    if (indexable) {
      document.head.querySelector('meta[name="robots"]')?.remove();
      setTag(
        'link[rel="canonical"]',
        () => Object.assign(document.createElement("link"), { rel: "canonical" }),
        (el) => ((el as HTMLLinkElement).href = location.origin + location.pathname),
      );
    } else {
      document.head.querySelector('link[rel="canonical"]')?.remove();
      setTag(
        'meta[name="robots"]',
        () => Object.assign(document.createElement("meta"), { name: "robots" }),
        (el) => ((el as HTMLMetaElement).content = "noindex, follow"),
      );
    }
  }, [lang, slug, tool]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[272px] shrink-0 border-r border-line bg-sidebar lg:block">
        <Sidebar current={slug} />
      </aside>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("menu")}>
          <button type="button" aria-label={t("closeMenu")} className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[86vw] max-w-[320px] animate-rise border-r border-line bg-sidebar shadow-2xl">
            <Sidebar current={slug} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:hidden">
          <IconButton label={t("menu")} onClick={() => setDrawer(true)} className="text-fg">
            <Menu className="size-5" />
          </IconButton>
          <Logo />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10 2xl:max-w-[1600px]">
          {!slug ? <Home /> : tool ? <ToolRoute tool={tool} /> : <NotFound />}
        </main>
        <footer className="border-t border-line px-4 py-5 text-center text-xs text-muted sm:px-6 lg:px-10">{t("footer")}</footer>
      </div>
    </div>
  );
}
