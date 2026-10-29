import type { MouseEvent, ReactNode } from "react";
import { useLang } from "../lib/i18n";
import { localize, navigate } from "../lib/router";

/**
 * In-app link: a real <a href> (crawlable, middle-click works) with client-side navigation.
 * `to` is a language-less app path ("/merge-pdf"); the current language prefix is added.
 */
export function Link({
  to,
  className,
  children,
  onClick,
  prefetch,
  ...rest
}: {
  to: string;
  className?: string;
  children: ReactNode;
  /** Runs before navigating (e.g. hand files to the next page, close the drawer). */
  onClick?: () => void;
  /** Called on hover/focus/touch so the target's code starts loading early. */
  prefetch?: () => void;
  "aria-current"?: "page";
  title?: string;
}) {
  const lang = useLang();
  return (
    <a
      href={localize(to, lang)}
      className={className}
      {...rest}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
