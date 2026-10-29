import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, ShieldCheck, Sparkles } from "lucide-react";
import type { EngineProps } from "../../engines";
import { JwtError, algSpec, decodeJwt, isHmac, relativeUnit, timeClaims, verifyJwt, type DecodedJwt } from "../../lib/dev/jwt";
import { useLang, useT } from "../../lib/i18n";
import { localeOf } from "../../lib/langs";
import { Button, Switch, TextArea, TextField, cx } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { CopyButton, ListCard, Note } from "../utility/shared";
import { Badge, useNow } from "./shared";
import { jwtS } from "./strings";

type JwtKey = keyof typeof jwtS.en;

const SAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImFkbWluIjp0cnVlLCJpYXQiOjE3NjcyMjU2MDAsImV4cCI6NDEwMjQ0NDgwMH0.o0SEZgRanZrCsorDKfg-1NXf1Tx1cwwt2ZnR6RP4LgE";
const SAMPLE_SECRET = "converter-demo-secret";

// jwt.io-style colours for the three parts.
const PART = ["text-[#e5484d]", "text-[#8e4ec6]", "text-[#0b87d6]"];

const ERRORS: Record<JwtError["code"], JwtKey> = {
  empty: "errEmpty",
  parts: "errParts",
  jwe: "errJwe",
  header: "errHeader",
  payload: "errPayload",
  alg: "errAlg",
  key: "errKey",
  keyType: "errKeyType",
};

/** Minimal JSON syntax colouring (keys, strings, numbers, literals). */
function JsonView({ text, testId }: { text: string; testId?: string }) {
  const parts: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    parts.push(text.slice(last, m.index));
    const cls = m[1] ? (m[2] ? "text-[#8e4ec6]" : "text-ok") : m[3] ? "text-accent-text" : "text-[#0b87d6]";
    parts.push(
      <span key={m.index} className={cls}>
        {m[1] ?? m[0]}
      </span>,
      m[2] ?? "",
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap wrap-anywhere" data-testid={testId}>
      {parts}
    </pre>
  );
}

function useTimeFormat() {
  const lang = useLang();
  const locale = localeOf(lang);
  return useMemo(() => {
    const abs = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" });
    const rel = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return (sec: number, nowSec: number) => ({ abs: abs.format(new Date(sec * 1000)), rel: rel.format(...relativeUnit(sec - nowSec)) });
  }, [locale]);
}

function Claims({ decoded }: { decoded: DecodedJwt }) {
  const t = useT(jwtS);
  const now = useNow(1000) / 1000;
  const fmt = useTimeFormat();
  const claims = timeClaims(decoded.payload, now);
  const badge = {
    valid: <Badge tone="ok">{t("statusValid")}</Badge>,
    expired: <Badge tone="err">{t("statusExpired")}</Badge>,
    notYet: <Badge tone="warn">{t("statusNotYet")}</Badge>,
    none: <Badge tone="muted">{t("statusNone")}</Badge>,
  }[claims.status];
  const rows = (["iat", "nbf", "exp"] as const).filter((k) => claims[k] !== undefined);
  return (
    <ListCard title={t("claims")} actions={<span data-testid="jwt-status">{badge}</span>} testId="jwt-claims">
      {rows.length ? (
        <div className="divide-y divide-line">
          {rows.map((k) => {
            const f = fmt(claims[k]!, now);
            return (
              <div key={k} className="flex min-w-0 flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4" data-testid={`jwt-${k}`}>
                <span className="shrink-0 text-xs font-medium text-muted sm:w-40">{t(k)}</span>
                <span className="min-w-0 text-sm">
                  {f.abs} <span className="text-muted">· {f.rel}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </ListCard>
  );
}

type Verdict = { state: "idle" | "valid" | "invalid" | "none" } | { state: "error"; key: JwtKey };

function Verify({ token, decoded, secret, setSecret, secretB64, setSecretB64, publicKey, setPublicKey }: {
  token: string;
  decoded: DecodedJwt | null;
  secret: string;
  setSecret: (s: string) => void;
  secretB64: boolean;
  setSecretB64: (b: boolean) => void;
  publicKey: string;
  setPublicKey: (s: string) => void;
}) {
  const t = useT(jwtS);
  const alg = String(decoded?.header.alg ?? "");
  const hmac = isHmac(alg);
  const [verdict, setVerdict] = useState<Verdict>({ state: "idle" });

  useEffect(() => {
    let live = true;
    const set = (v: Verdict) => live && setVerdict(v);
    if (!decoded) set({ state: "idle" });
    else if (alg === "none") set({ state: "none" });
    else if (!algSpec(alg)) set({ state: "error", key: "errAlg" });
    else if (!(hmac ? secret : publicKey.trim())) set({ state: "idle" });
    else
      verifyJwt(token, hmac ? { secret, secretBase64: secretB64 } : { publicKey }).then(
        (ok) => set({ state: ok ? "valid" : "invalid" }),
        (e) => set({ state: "error", key: e instanceof JwtError ? ERRORS[e.code] : "errKey" }),
      );
    return () => {
      live = false;
    };
  }, [token, decoded, alg, hmac, secret, secretB64, publicKey]);

  if (!decoded) return <Note>{t("verifyHint")}</Note>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium">{t("alg")}</span>
        <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs" data-testid="jwt-alg">
          {alg || "—"}
        </span>
      </div>
      {alg === "none" ? null : hmac ? (
        <>
          <TextField label={t("secret")} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t("secretPlaceholder")} spellCheck={false} autoComplete="off" className="font-mono" data-testid="jwt-secret" />
          <Switch checked={secretB64} onChange={setSecretB64} label={t("secretBase64")} />
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <TextArea label={t("publicKey")} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder={t("publicKeyPlaceholder")} spellCheck={false} className="min-h-36 text-xs" data-testid="jwt-key" />
          <p className="text-xs leading-relaxed text-muted">{t("publicKeyHint")}</p>
        </div>
      )}
      <div
        role="status"
        data-testid="jwt-verdict"
        data-state={verdict.state}
        className={cx(
          "flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium",
          verdict.state === "valid" && "bg-ok/12 text-ok",
          (verdict.state === "invalid" || verdict.state === "error") && "bg-err/10 text-err",
          (verdict.state === "idle" || verdict.state === "none") && "bg-surface-2 text-muted",
        )}
      >
        {verdict.state === "valid" ? <CircleCheck className="mt-px size-4 shrink-0" /> : verdict.state === "invalid" || verdict.state === "error" ? <CircleX className="mt-px size-4 shrink-0" /> : null}
        <span className="min-w-0">
          {verdict.state === "valid"
            ? t("sigValid")
            : verdict.state === "invalid"
              ? t("sigInvalid")
              : verdict.state === "none"
                ? t("sigNone")
                : verdict.state === "error"
                  ? t(verdict.key, { alg })
                  : t("sigIdle")}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t("verifyHint")}</p>
    </div>
  );
}

export default function JwtTool({ meta }: EngineProps) {
  const t = useT(jwtS);
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [secretB64, setSecretB64] = useState(false);
  const [publicKey, setPublicKey] = useState("");

  const parsed = useMemo((): { ok: true; d: DecodedJwt } | { ok: false; key: JwtKey } => {
    try {
      return { ok: true, d: decodeJwt(token) };
    } catch (e) {
      return { ok: false, key: e instanceof JwtError ? ERRORS[e.code] : "errParts" };
    }
  }, [token]);
  const decoded = parsed.ok ? parsed.d : null;

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <p className="flex items-start gap-2.5 rounded-xl border border-ok/25 bg-ok/8 px-3.5 py-3 text-[13px] leading-relaxed text-fg" data-testid="jwt-privacy">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
            <span className="min-w-0">{t("privacy")}</span>
          </p>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <label htmlFor="jwt-input" className="text-xs font-medium text-muted">
                {t("token")}
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setToken(SAMPLE);
                  setSecret(SAMPLE_SECRET);
                  setSecretB64(false);
                }}
              >
                <Sparkles className="size-3.5" />
                {t("sample")}
              </Button>
            </div>
            <TextArea
              id="jwt-input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("tokenPlaceholder")}
              spellCheck={false}
              autoComplete="off"
              className="min-h-32 wrap-anywhere"
              data-testid="jwt-input"
            />
          </div>
          {decoded ? (
            <>
              <p className="rounded-xl bg-surface-2 p-3 font-mono text-[13px] leading-relaxed wrap-anywhere" data-testid="jwt-colored">
                {decoded.parts.map((p, i) => (
                  <span key={i}>
                    {i ? <span className="text-muted">.</span> : null}
                    <span className={PART[i]}>{p}</span>
                  </span>
                ))}
              </p>
              <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                <ListCard title={<span className={PART[0]}>{t("header")}</span>} actions={<CopyButton value={decoded.headerText} label={t("header")} />}>
                  <JsonView text={decoded.headerText} testId="jwt-header" />
                </ListCard>
                <ListCard
                  title={
                    <span className={PART[1]}>
                      {t("payload")} {decoded.payload ? null : <span className="font-normal text-muted">· {t("notJson")}</span>}
                    </span>
                  }
                  actions={<CopyButton value={decoded.payloadText} label={t("payload")} />}
                >
                  <JsonView text={decoded.payloadText} testId="jwt-payload" />
                </ListCard>
              </div>
              <Claims decoded={decoded} />
            </>
          ) : token.trim() ? (
            <Note tone="err">{t(parsed.ok ? "errEmpty" : parsed.key)}</Note>
          ) : (
            <Note>{t("errEmpty")}</Note>
          )}
        </div>
      }
      settings={
        <>
          <h3 className="-mb-2 text-[13px] font-semibold">{t("verify")}</h3>
          <Verify
            token={token}
            decoded={decoded}
            secret={secret}
            setSecret={setSecret}
            secretB64={secretB64}
            setSecretB64={setSecretB64}
            publicKey={publicKey}
            setPublicKey={setPublicKey}
          />
        </>
      }
    />
  );
}
