import { lazy } from "react";
import { Braces, CodeXml, Database, FileBraces, FileCode, FileCode2, FileJson, FileJson2, FileSpreadsheet, Sheet, Table, Table2, WandSparkles } from "lucide-react";
import type { EngineMap, IconMap } from "../../engines";

export const engines: EngineMap = {
  "data-table": lazy(() => import("./spreadsheet-tool")),
  "data-format": lazy(() => import("./data-format-tool")),
};

export const icons: IconMap = {
  "spreadsheet-converter": Sheet,
  "excel-to-csv": FileSpreadsheet,
  "csv-to-excel": Table,
  "csv-to-json": FileJson,
  "json-to-csv": Table2,
  "excel-to-json": FileJson2,
  "json-to-excel": FileSpreadsheet,
  "csv-to-sql": Database,
  "json-formatter": WandSparkles,
  "json-to-yaml": FileCode,
  "yaml-to-json": FileJson,
  "json-to-xml": CodeXml,
  "xml-to-json": Braces,
  "json-to-toml": FileCode2,
  "toml-to-json": FileBraces,
};
