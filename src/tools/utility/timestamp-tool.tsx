import { useEffect, useMemo, useState } from "react";
import { TimerReset } from "lucide-react";
import type { EngineProps } from "../../engines";
import { useLang, useT } from "../../lib/i18n";
import { dateInZone, dayOfYear, formatOffset, isoInZone, isoWeek, offsetSeconds, parseTimestamp, relativeTime, timeZones, type EpochUnit } from "../../lib/utility/timestamp";
import { Button, TextField } from "../../ui/kit";
import { ToolLayout } from "../../ui/tool-layout";
import { ListCard, Note, Select, Tabs, ValueRow } from "./shared";
import { timeStrings } from "./strings";

type UnitChoice = EpochUnit | "auto";
const ZONE_KEY = "converter.util.zone";
const SCALE: Record<UnitChoice, number> = { auto: 1e-3, s: 1e-3, ms: 1, us: 1e3, ns: 1e6 };

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function initialZone(): string {
  try {
    const saved = localStorage.getItem(ZONE_KEY);
    if (saved) return saved;
  } catch {
    // storage blocked
  }
  return localZone() === "America/New_York" ? "Europe/London" : "America/New_York";
}

/** Instant → text in the chosen unit (auto = seconds). */
const fromMs = (ms: number, unit: UnitChoice) => String(Math.floor(ms * SCALE[unit]));
const plain = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(3));
/** Value for <input type="datetime-local"> in local time. */
function localInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 19);
}

export default function TimestampTool({ meta }: EngineProps) {
  const t = useT(timeStrings);
  const lang = useLang();
  const [unit, setUnit] = useState<UnitChoice>("auto");
  const [text, setText] = useState(() => fromMs(Date.now(), "auto"));
  const [zone, setZoneState] = useState(initialZone);
  const [now, setNow] = useState(() => Date.now());
  const here = localZone();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const setZone = (z: string) => {
    setZoneState(z);
    try {
      localStorage.setItem(ZONE_KEY, z);
    } catch {
      // storage blocked
    }
  };

  // Offsets are taken once at load: labels are a guide, rows below use the real instant.
  const zoneOptions = useMemo(() => {
    const at = Date.now();
    return timeZones().map((z) => (
      <option key={z.id} value={z.id}>
        {z.city}
        {z.region ? ` — ${z.region}` : ""} (UTC{formatOffset(offsetSeconds(at, z.id))})
      </option>
    ));
  }, []);

  const parsed = parseTimestamp(text, unit);
  const ms = parsed?.ms ?? null;
  const full = (timeZone?: string) => new Intl.DateTimeFormat(lang, { dateStyle: "full", timeStyle: "long", timeZone });
  const zoneLabel = (id: string) => id.replace(/_/g, " ");
  const ymd = ms === null ? null : dateInZone(ms, here);

  return (
    <ToolLayout
      meta={meta}
      input={
        <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div className="flex min-w-0 items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextField
                label={t("input")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("placeholder")}
                autoComplete="off"
                spellCheck={false}
                className="h-12 font-mono text-lg"
                aria-invalid={text.trim() !== "" && !parsed}
                data-testid="ts-input"
              />
            </div>
            <Button size="lg" onClick={() => setText(fromMs(Date.now(), unit))} data-testid="ts-now">
              <TimerReset className="size-4" />
              {t("now")}
            </Button>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[13px] font-medium">{t("unit")}</span>
            <Tabs<UnitChoice>
              label={t("unit")}
              value={unit}
              onChange={setUnit}
              className="grid-cols-5"
              options={[
                { value: "auto", label: t("auto") },
                { value: "s", label: "s" },
                { value: "ms", label: "ms" },
                { value: "us", label: "µs" },
                { value: "ns", label: "ns" },
              ]}
            />
          </div>
          {!parsed ? (
            text.trim() ? <Note tone="err">{t("invalid")}</Note> : null
          ) : (
            <Note>
              <span data-testid="ts-detected">{parsed.unit ? t("detected", { unit: t(`unit_${parsed.unit}`) }) : t("detectedDate")}</span>
              {unit === "auto" && parsed.unit ? ` · ${t("autoHint")}` : ""}
            </Note>
          )}
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">{t("pick")}</span>
            <input
              type="datetime-local"
              step={1}
              value={ms === null ? "" : localInput(ms)}
              onChange={(e) => {
                const v = new Date(e.target.value).getTime();
                if (Number.isFinite(v)) setText(fromMs(v, unit));
              }}
              className="h-9 w-full min-w-0 rounded-[10px] border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-accent sm:max-w-72"
            />
          </label>
        </section>
      }
      settings={
        <div className="flex flex-col gap-2">
          <Select label={t("zone")} value={zone} onChange={(e) => setZone(e.target.value)} data-testid="ts-zone">
            {zoneOptions}
          </Select>
          <p className="text-xs leading-relaxed text-muted">{t("zoneHint")}</p>
          <p className="text-xs leading-relaxed text-muted">
            {t("yourZone")}: <span className="font-mono text-fg">{zoneLabel(here)}</span>
          </p>
        </div>
      }
      results={
        ms === null ? null : (
          <ListCard title={t("results")} testId="ts-results">
            <div className="divide-y divide-line">
              <ValueRow label={t("unixS")} value={plain(ms / 1000)} testId="ts-unix-s" />
              <ValueRow label={t("unixMs")} value={plain(ms)} testId="ts-unix-ms" />
              <ValueRow label={t("iso")} value={new Date(ms).toISOString()} testId="ts-iso" />
              <ValueRow label={t("isoLocal")} value={isoInZone(ms, here)} testId="ts-iso-local" />
              <ValueRow label={t("utc")} value={new Date(ms).toUTCString()} testId="ts-utc" />
              <ValueRow label={t("local")} value={full().format(ms)} sub={zoneLabel(here)} mono={false} testId="ts-local" />
              <ValueRow label={zoneLabel(zone)} value={full(zone).format(ms)} sub={isoInZone(ms, zone)} mono={false} testId="ts-zone-time" />
              <ValueRow label={t("relative")} value={relativeTime(ms, now, lang)} mono={false} testId="ts-relative" />
              {ymd ? <ValueRow label={t("calendar")} value={t("calendarValue", { day: dayOfYear(...ymd), year: ymd[0], week: isoWeek(...ymd).week })} mono={false} /> : null}
            </div>
          </ListCard>
        )
      }
    />
  );
}
