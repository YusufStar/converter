import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, LocateFixed, Loader2, X } from "lucide-react";
import type { EngineProps } from "../../engines";
import { logoBox, matrixSvg, isDark, type MatrixStyle, type ModuleMatrix } from "../../lib/dev/matrix";
import { emailPayload, geoPayload, phonePayload, smsPayload, vcardPayload, wifiPayload, type QrKind, type VCard, type WifiSecurity } from "../../lib/dev/qr-content";
import { loadWriter, writeSymbol } from "../../lib/dev/zxing-writer";
import { downloadBlob } from "../../lib/download";
import { useT } from "../../lib/i18n";
import { useObjectUrl } from "../../lib/use-object-url";
import { Button, ColorField, Field, IconButton, NumberField, Segmented, Slider, Switch, TextArea, TextField } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { ListCard, Note, Tabs, ValueRow } from "../utility/shared";
import { canvasPng, contrast, isInverted } from "./shared";
import { devCommon, qrS } from "./strings";

type Ecc = "L" | "M" | "Q" | "H";
type QrKey = keyof typeof qrS.en;

const KINDS: [QrKind, QrKey][] = [
  ["text", "tText"],
  ["wifi", "tWifi"],
  ["email", "tEmail"],
  ["phone", "tPhone"],
  ["sms", "tSms"],
  ["vcard", "tVcard"],
  ["geo", "tGeo"],
];

/** [field, label, input type, full row on phones] */
const VCARD_FIELDS: [keyof VCard, QrKey, string?, boolean?][] = [
  ["firstName", "firstName"],
  ["lastName", "lastName"],
  ["org", "org"],
  ["title", "jobTitle"],
  ["phone", "workPhone", "tel"],
  ["mobile", "mobile", "tel"],
  ["email", "email", "email", true],
  ["url", "website", "url", true],
  ["street", "street", undefined, true],
  ["city", "city"],
  ["zip", "zip"],
  ["country", "country"],
];

async function renderPng(m: ModuleMatrix, { size, margin, fg, bg, transparent, logo }: MatrixStyle): Promise<Blob> {
  const cols = m.width + margin * 2;
  const rows = m.height + margin * 2;
  const s = size / cols;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = Math.round(rows * s);
  const ctx = canvas.getContext("2d")!;
  if (!transparent) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = fg;
  // Rounded edges per module: no hairline seams between neighbours at fractional scales.
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      if (!isDark(m, x, y)) continue;
      const x0 = Math.round((x + margin) * s);
      const y0 = Math.round((y + margin) * s);
      ctx.fillRect(x0, y0, Math.round((x + margin + 1) * s) - x0, Math.round((y + margin + 1) * s) - y0);
    }
  if (logo) {
    const b = logoBox(m, margin, logo.scale);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect((b.x - b.pad) * s, (b.y - b.pad) * s, (b.side + b.pad * 2) * s, (b.side + b.pad * 2) * s, b.pad * s);
    ctx.fill();
    const img = new Image();
    img.src = logo.href;
    await img.decode();
    const fit = Math.min((b.side * s) / img.naturalWidth, (b.side * s) / img.naturalHeight);
    const w = img.naturalWidth * fit;
    const h = img.naturalHeight * fit;
    ctx.drawImage(img, b.x * s + (b.side * s - w) / 2, b.y * s + (b.side * s - h) / 2, w, h);
  }
  return canvasPng(canvas);
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export default function QrTool({ meta }: EngineProps) {
  const t = useT(qrS);
  const tc = useT(devCommon);
  const [kind, setKind] = useState<QrKind>("text");
  const [text, setText] = useState("https://converter.openwild.ai");
  const [wifi, setWifi] = useState({ ssid: "", password: "", security: "WPA" as WifiSecurity, hidden: false });
  const [mail, setMail] = useState({ to: "", subject: "", body: "" });
  const [phone, setPhone] = useState("");
  const [sms, setSms] = useState({ number: "", message: "" });
  const [card, setCard] = useState<VCard>({});
  const [geo, setGeo] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [locating, setLocating] = useState<"idle" | "busy" | "failed">("idle");

  const [ecc, setEcc] = useState<Ecc>("M");
  const [size, setSize] = useState(1024);
  const [margin, setMargin] = useState(4);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [transparent, setTransparent] = useState(false);
  const [logo, setLogo] = useState<{ name: string; href: string } | null>(null);
  const [logoScale, setLogoScale] = useState(22);
  const logoInput = useRef<HTMLInputElement>(null);

  const [symbol, setSymbol] = useState<ModuleMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo((): string | null => {
    switch (kind) {
      case "wifi":
        return wifi.ssid ? wifiPayload(wifi) : null;
      case "email":
        return mail.to.trim() ? emailPayload(mail) : null;
      case "phone":
        return phone.trim() ? phonePayload(phone) : null;
      case "sms":
        return sms.number.trim() ? smsPayload(sms) : null;
      case "vcard":
        return Object.values(card).some((v) => v?.trim()) ? vcardPayload(card) : null;
      case "geo":
        return geoPayload(geo.lat, geo.lng);
      default:
        return text || null;
    }
  }, [kind, text, wifi, mail, phone, sms, card, geo]);
  const level: Ecc = logo ? "H" : ecc;

  useEffect(() => void loadWriter().catch(() => undefined), []);

  useEffect(() => {
    if (!payload) {
      setSymbol(null);
      setError(null);
      return;
    }
    let live = true;
    writeSymbol(payload, { format: "QRCode", options: `ecLevel=${level}`, scale: 1 }).then(
      (r) => {
        if (!live) return;
        // zxing's own message ("Error 5xx: …") is replaced by ours; the only failure here is capacity.
        setError(r.error ? "tooLong" : null);
        setSymbol(r.error ? null : { data: r.symbol.data, width: r.symbol.width, height: r.symbol.height });
      },
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [payload, level]);

  const style = useMemo<MatrixStyle>(
    () => ({ size, margin, fg, bg, transparent, logo: logo ? { href: logo.href, scale: logoScale / 100 } : null }),
    [size, margin, fg, bg, transparent, logo, logoScale],
  );
  const svg = useMemo(() => (symbol ? matrixSvg(symbol, style) : null), [symbol, style]);
  const errorText = error === "tooLong" ? t("tooLong") : error;
  const svgBlob = useMemo(() => (svg ? new Blob([svg], { type: "image/svg+xml" }) : null), [svg]);
  const preview = useObjectUrl(svgBlob);
  const bytes = payload ? new TextEncoder().encode(payload).length : 0;
  const ratio = contrast(fg, bg);

  const locate = () => {
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 });
        setLocating("idle");
      },
      () => setLocating("failed"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const form = {
    text: <TextArea label={t("text")} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-28 wrap-anywhere" data-testid="qr-text" />,
    wifi: (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <TextField label={t("ssid")} value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} data-testid="qr-ssid" />
        <TextField label={t("password")} value={wifi.password} onChange={(e) => setWifi({ ...wifi, password: e.target.value })} disabled={wifi.security === "nopass"} />
        <Field label={t("security")}>
          <Segmented<WifiSecurity>
            label={t("security")}
            value={wifi.security}
            onChange={(security) => setWifi({ ...wifi, security })}
            size="sm"
            options={[
              { value: "WPA", label: "WPA/WPA2/WPA3" },
              { value: "WEP", label: "WEP" },
              { value: "nopass", label: t("secNone") },
            ]}
          />
        </Field>
        <div className="flex items-end pb-1.5">
          <Switch checked={wifi.hidden} onChange={(hidden) => setWifi({ ...wifi, hidden })} label={t("hidden")} />
        </div>
      </div>
    ),
    email: (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <TextField label={t("to")} type="email" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} />
        <TextField label={t("subject")} value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
        <div className="sm:col-span-2">
          <TextArea label={t("body")} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} className="min-h-24 font-sans" />
        </div>
      </div>
    ),
    phone: <TextField label={t("phone")} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+90 532 000 00 00" />,
    sms: (
      <div className="grid min-w-0 gap-3">
        <TextField label={t("phone")} type="tel" value={sms.number} onChange={(e) => setSms({ ...sms, number: e.target.value })} />
        <TextArea label={t("message")} value={sms.message} onChange={(e) => setSms({ ...sms, message: e.target.value })} className="min-h-24 font-sans" />
      </div>
    ),
    vcard: (
      <div className="grid min-w-0 grid-cols-2 gap-3">
        {VCARD_FIELDS.map(([k, label, type, wide]) => (
          <div key={k} className={wide ? "col-span-2 min-w-0 sm:col-span-1" : "min-w-0"}>
            <TextField label={t(label)} type={type} value={card[k] ?? ""} onChange={(e) => setCard({ ...card, [k]: e.target.value })} />
          </div>
        ))}
        <div className="col-span-2">
          <TextArea label={t("note")} value={card.note ?? ""} onChange={(e) => setCard({ ...card, note: e.target.value })} className="min-h-20 font-sans" />
        </div>
      </div>
    ),
    geo: (
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <NumberField label={t("lat")} value={geo.lat} onChange={(lat) => setGeo({ ...geo, lat })} min={-90} max={90} step={0.000001} placeholder="41.0082" />
          <NumberField label={t("lng")} value={geo.lng} onChange={(lng) => setGeo({ ...geo, lng })} min={-180} max={180} step={0.000001} placeholder="28.9784" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={locate} disabled={locating === "busy" || !("geolocation" in navigator)}>
            {locating === "busy" ? <Loader2 className="size-3.5 animate-spin" /> : <LocateFixed className="size-3.5" />}
            {locating === "busy" ? t("locating") : t("myLocation")}
          </Button>
          {locating === "failed" ? <span className="text-xs text-err">{t("geoFailed")}</span> : null}
        </div>
        {geo.lat !== null && geo.lng !== null && !payload ? <Note tone="err">{t("geoInvalid")}</Note> : null}
      </div>
    ),
  }[kind];

  return (
    <ToolLayout
      meta={meta}
      input={
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<QrKind> label={t("template")} value={kind} onChange={setKind} className="grid-cols-3 sm:grid-cols-4 xl:grid-cols-7" options={KINDS.map(([value, key]) => ({ value, label: t(key) }))} />
          <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">{form}</div>
          <ListCard
            title={t("preview")}
            testId="qr-preview"
            actions={
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={!symbol} onClick={async () => symbol && downloadBlob(await renderPng(symbol, style), "qr-code.png")} data-testid="qr-png">
                  <Download className="size-3.5" />
                  {tc("downloadPng")}
                </Button>
                <Button size="sm" disabled={!svgBlob} onClick={() => svgBlob && downloadBlob(svgBlob, "qr-code.svg")} data-testid="qr-svg">
                  <Download className="size-3.5" />
                  {tc("downloadSvg")}
                </Button>
              </div>
            }
          >
            <div className="flex min-w-0 flex-col items-center gap-3 p-4">
              {preview ? (
                <img src={preview} alt={payload ?? ""} className="checker aspect-square w-full max-w-[320px] rounded-lg border border-line object-contain" data-testid="qr-image" />
              ) : (
                <div className="flex aspect-square w-full max-w-[320px] items-center justify-center rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-muted">
                  {errorText ?? t("needContent")}
                </div>
              )}
              {errorText && preview ? <Note tone="err">{errorText}</Note> : null}
              {error && !preview ? null : !payload ? null : symbol ? null : <Loader2 className="size-4 animate-spin text-muted" aria-label={tc("loading")} />}
            </div>
            {payload && symbol ? (
              <div className="border-t border-line">
                <ValueRow label={t("encoded")} value={<span className="whitespace-pre-wrap">{payload}</span>} copy={payload} sub={t("info", { w: symbol.width, n: bytes })} testId="qr-payload" />
              </div>
            ) : null}
          </ListCard>
        </div>
      }
      settings={
        <>
          <Field label={t("ecc")} hint={logo ? t("eccLogo") : t("eccHint")}>
            <Segmented<Ecc>
              label={t("ecc")}
              value={level}
              onChange={setEcc}
              size="sm"
              columns={4}
              options={(
                [
                  ["L", "7%"],
                  ["M", "15%"],
                  ["Q", "25%"],
                  ["H", "30%"],
                ] as const
              ).map(([v, pct]) => ({ value: v, label: `${v} · ${pct}`, disabled: !!logo && v !== "H" }))}
            />
          </Field>
          <Slider label={t("size")} value={size} onChange={setSize} min={128} max={2048} step={64} suffix=" px" />
          <Slider label={t("margin")} value={margin} onChange={setMargin} min={0} max={10} suffix={t("marginSuffix")} />
          <div className="grid grid-cols-2 gap-3">
            <ColorField label={tc("foreground")} value={fg} onChange={setFg} />
            <ColorField label={tc("background")} value={bg} onChange={setBg} />
          </div>
          <Switch checked={transparent} onChange={setTransparent} label={t("transparent")} />
          {ratio < 3 ? <Note tone="err">{tc("lowContrast")}</Note> : isInverted(fg, bg) ? <Note>{tc("inverted")}</Note> : null}
          <Field label={t("logo")}>
            <input
              ref={logoInput}
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="qr-logo-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setLogo({ name: f.name, href: await readDataUrl(f) });
              }}
            />
            {logo ? (
              <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line p-2">
                <img src={logo.href} alt="" className="checker size-10 shrink-0 rounded-lg border border-line object-contain" />
                <span className="min-w-0 flex-1 truncate text-sm">{logo.name}</span>
                <IconButton label={t("logoRemove")} onClick={() => setLogo(null)}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ) : (
              <Button onClick={() => logoInput.current?.click()}>
                <ImagePlus className="size-4" />
                {t("logoAdd")}
              </Button>
            )}
          </Field>
          {logo ? <Slider label={t("logoSize")} value={logoScale} onChange={setLogoScale} min={10} max={30} suffix="%" /> : null}
        </>
      }
    />
  );
}
