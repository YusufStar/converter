import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { protectPdf, warmQpdf } from "../../lib/pdf-extra/qpdf-client";
import { ALL_ALLOWED, type Permissions } from "../../lib/pdf-extra/qpdf";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Field, Switch } from "../../ui/kit";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pdfBlob, zipNameFor } from "../pdf/common";
import { PasswordField } from "./common";
import { s } from "./strings";

const PERMS = [
  ["print", "permPrint"],
  ["copy", "permCopy"],
  ["modify", "permModify"],
  ["annotate", "permAnnotate"],
  ["forms", "permForms"],
] as const;

export default function ProtectTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [user, setUser] = useState("");
  const [owner, setOwner] = useState("");
  const [perms, setPerms] = useState<Permissions>(ALL_ALLOWED);
  const n = queue.items.length;
  const restricted = PERMS.some(([k]) => !perms[k]);

  useEffect(warmQpdf, []);

  const run = () =>
    queue.runEach(async (file) => {
      const bytes = await protectPdf(new Uint8Array(await file.arrayBuffer()), user, owner, perms);
      return { name: `${splitName(file.name).base}-protected.pdf`, blob: pdfBlob(bytes) };
    }, 4);

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          <PasswordField label={t("openPassword")} value={user} onChange={setUser} hint={t("openPasswordHint")} testId="password" />
          <PasswordField label={t("ownerPassword")} value={owner} onChange={setOwner} hint={t("ownerPasswordHint")} testId="owner-password" />
          <Field label={t("permissions")} hint={t("permHint")}>
            <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
              {PERMS.map(([key, label]) => (
                <Switch key={key} label={t(label)} checked={perms[key]} onChange={(v) => setPerms((p) => ({ ...p, [key]: v }))} />
              ))}
            </div>
          </Field>
          {restricted && owner && owner === user ? <Hint tone="warn">{t("ownerSame")}</Hint> : null}
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
            <span>{t("aes")}</span>
          </p>
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("protectRunN", { n }) : t("protectRun")} disabled={!user} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
