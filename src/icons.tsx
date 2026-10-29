import { Archive, FileText, FileType2, Image, Sheet, Sparkles, Type, Video, type LucideIcon } from "lucide-react";
import type { GroupId } from "./catalog-types";
import { toolBySlug } from "./catalog";
import { ICONS } from "./engines";
import { cx } from "./ui/kit";

export const GROUP_ICON: Record<GroupId, LucideIcon> = {
  image: Image,
  pdf: FileType2,
  document: FileText,
  media: Video,
  data: Sheet,
  archive: Archive,
  font: Type,
  utility: Sparkles,
};

/** One hue per group so the sidebar and cards are scannable at a glance. */
export const GROUP_HUE: Record<GroupId, string> = {
  image: "#ff6b2c",
  pdf: "#e5484d",
  document: "#3e7bfa",
  media: "#8e4ec6",
  data: "#30a46c",
  archive: "#d6a116",
  font: "#d6409f",
  utility: "#12a594",
};

export function ToolIcon({ slug, group, size = "md" }: { slug?: string; group: GroupId; size?: "sm" | "md" | "lg" }) {
  // Preset pages (png-to-jpg…) borrow their parent tool's icon.
  const Icon = (slug && (ICONS[slug] ?? ICONS[toolBySlug.get(slug)?.parent ?? ""])) || GROUP_ICON[group];
  const hue = GROUP_HUE[group];
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center",
        size === "sm" && "size-6 rounded-md",
        size === "md" && "size-9 rounded-[10px]",
        size === "lg" && "size-12 rounded-xl",
      )}
      style={{ background: `color-mix(in srgb, ${hue} 14%, transparent)`, color: hue }}
    >
      <Icon className={cx(size === "sm" && "size-3.5", size === "md" && "size-[18px]", size === "lg" && "size-6")} strokeWidth={2} />
    </span>
  );
}
