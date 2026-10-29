import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, LockOpen, ShieldAlert } from "lucide-react";
import type { EngineProps } from "../../engines";
import { splitName } from "../../lib/files";
import { useT } from "../../lib/i18n";
import { WRONG_PASSWORD, type Protection } from "../../lib/pdf-extra/qpdf";
import { pdfProtection, unlockPdf, warmQpdf } from "../../lib/pdf-extra/qpdf-client";
import { useQueue } from "../../lib/use-queue";
import { FileInput } from "../../ui/files";
import { Results } from "../../ui/results";
import { RunButton, ToolLayout } from "../../ui/tool-layout";
import { Hint, PDF_ACCEPT, pdfBlob, zipNameFor } from "../pdf/common";
import { PasswordField } from "./common";
import { s } from "./strings";

type Status = Protection | "bad";

const STATUS_ICON = { locked: Lock, restricted: ShieldAlert, none: LockOpen, bad: ShieldAlert };
const STATUS_TEXT = { locked: "statusLocked", restricted: "statusRestricted", none: "statusNone", bad: "statusBad" } as const;

export default function UnlockTool({ meta }: EngineProps) {
  const t = useT(s);
  const queue = useQueue();
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState<string | null>(null);
  // What each queued file needs, checked with qpdf as soon as it's added (by queue item id).
  const [status, setStatus] = useState<Record<string, Status>>({});
  const asked = useRef(new Set<string>());
  const field = useRef<HTMLInputElement>(null);
  const n = queue.items.length;

  useEffect(warmQpdf, []);

  useEffect(() => {
    for (const it of queue.items) {
      if (asked.current.has(it.id)) continue;
      asked.current.add(it.id);
      it.file
        .arrayBuffer()
        .then((b) => pdfProtection(new Uint8Array(b)))
        .catch((): Status => "bad")
        .then((st) => setStatus((m) => ({ ...m, [it.id]: st })));
    }
  }, [queue.items]);

  const known = queue.items.map((it) => status[it.id]);
  const checking = known.some((st) => !st);
  const needsPassword = known.includes("locked");
  // Shown until the password is edited for another try.
  const wrong = password === tried && queue.items.some((it) => it.status === "error" && it.error === WRONG_PASSWORD);

  // A wrong password keeps the files queued: put the cursor back in the field for another try.
  useEffect(() => {
    if (wrong && !queue.busy) field.current?.select();
  }, [wrong, queue.busy]);

  const run = () => {
    setTried(password);
    return queue.runEach(async (file) => {
      const { bytes, was } = await unlockPdf(new Uint8Array(await file.arrayBuffer()), password);
      return {
        name: `${splitName(file.name).base}-unlocked.pdf`,
        blob: pdfBlob(bytes),
        note: t(was === "restricted" ? "restrictionsRemoved" : "passwordRemoved"),
      };
    }, 4);
  };

  return (
    <ToolLayout
      meta={meta}
      input={<FileInput queue={queue} accept={PDF_ACCEPT} formats="PDF" />}
      settings={
        <>
          {n ? (
            <ul className="flex flex-col gap-2.5" data-testid="unlock-status">
              {queue.items.map((it) => {
                const st = status[it.id];
                const Icon = st ? STATUS_ICON[st] : Loader2;
                return (
                  <li key={it.id} className="flex min-w-0 items-start gap-2 text-xs">
                    <Icon className={st ? "mt-0.5 size-3.5 shrink-0 text-muted" : "mt-0.5 size-3.5 shrink-0 animate-spin text-muted"} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium" title={it.file.name}>
                        {it.file.name}
                      </span>
                      <span className="text-muted">{st ? t(STATUS_TEXT[st]) : t("checking")}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {n && !checking && !needsPassword ? (
            <Hint>{t("restrictedOnly")}</Hint>
          ) : (
            <PasswordField
              ref={field}
              label={t("unlockPassword")}
              value={password}
              onChange={setPassword}
              hint={t("unlockPasswordHint")}
              error={wrong ? t("wrongPassword") : null}
              autoComplete="current-password"
              testId="password"
            />
          )}
        </>
      }
      action={<RunButton queue={queue} onRun={run} label={n > 1 ? t("unlockRunN", { n }) : t("unlockRun")} disabled={checking || (needsPassword && !password)} />}
      results={<Results outputs={queue.outputs} zipName={zipNameFor(queue, meta.slug)} />}
    />
  );
}
