import { lazy } from "react";
import { ArchiveRestore, FileArchive, FolderArchive, FolderOpen, PackageOpen } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "archive-zip": lazy(() => import("./zip-tool")),
  "archive-extract": lazy(() => import("./extract-tool")),
  "archive-gzip": lazy(() => import("./gzip-tool")),
};

export const icons: IconMap = {
  "zip-creator": FolderArchive,
  unzip: PackageOpen,
  "tar-extractor": FolderOpen,
  "gzip-compress": FileArchive,
  "gzip-decompress": ArchiveRestore,
};
