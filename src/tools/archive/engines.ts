import { ArchiveRestore, FileArchive, FileBox, FolderArchive, FolderOpen, PackageOpen, PackagePlus, Package } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";
import { lazyEngine } from "../../lib/lazy-engine";

export const engines: EngineMap = {
  "archive-zip": lazyEngine(() => import("./zip-tool")),
  "archive-extract": lazyEngine(() => import("./extract-tool")),
  "archive-gzip": lazyEngine(() => import("./gzip-tool")),
  "archive-create": lazyEngine(() => import("./create-tool")),
};

export const icons: IconMap = {
  "zip-creator": FolderArchive,
  unzip: PackageOpen,
  "tar-extractor": FolderOpen,
  "gzip-compress": FileArchive,
  "gzip-decompress": ArchiveRestore,
  "rar-extractor": Package,
  "7z-extractor": FileBox,
  "7z-creator": PackagePlus,
};
