// Payload builders for QR code templates (Wi-Fi, e-mail, phone, SMS, vCard, geo). The formats
// are the de-facto ones phone cameras understand (ZXing "barcode contents" conventions).

export type QrKind = "text" | "wifi" | "email" | "phone" | "sms" | "vcard" | "geo";

export type WifiSecurity = "WPA" | "WEP" | "nopass";

/** Wi-Fi fields escape \ ; , : and " with a backslash. */
const wifiEsc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

export function wifiPayload({ ssid, password = "", security = "WPA", hidden = false }: { ssid: string; password?: string; security?: WifiSecurity; hidden?: boolean }): string {
  const pass = security === "nopass" ? "" : `P:${wifiEsc(password)};`;
  return `WIFI:T:${security};S:${wifiEsc(ssid)};${pass}${hidden ? "H:true;" : ""};`;
}

export function emailPayload({ to, subject = "", body = "" }: { to: string; subject?: string; body?: string }): string {
  const q = [subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join("&");
  return `mailto:${to.trim()}${q ? `?${q}` : ""}`;
}

/** Keeps digits and the dialable symbols + * # (spaces, dashes and brackets dropped). */
const dialable = (n: string) => n.replace(/[^\d+*#]/g, "");

export const phonePayload = (number: string) => `tel:${dialable(number)}`;

export const smsPayload = ({ number, message = "" }: { number: string; message?: string }) => `SMSTO:${dialable(number)}:${message}`;

export interface VCard {
  firstName?: string;
  lastName?: string;
  org?: string;
  title?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  url?: string;
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
  note?: string;
}

/** vCard 3.0 text values escape \ , ; and newlines. */
const vEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

export function vcardPayload(c: VCard): string {
  const v = (s?: string) => vEsc(s?.trim() ?? "");
  const full = [c.firstName, c.lastName].map((s) => s?.trim()).filter(Boolean).join(" ");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${v(c.lastName)};${v(c.firstName)};;;`, `FN:${vEsc(full || c.org?.trim() || "")}`];
  if (c.org?.trim()) lines.push(`ORG:${v(c.org)}`);
  if (c.title?.trim()) lines.push(`TITLE:${v(c.title)}`);
  if (c.phone?.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${c.phone.trim()}`);
  if (c.mobile?.trim()) lines.push(`TEL;TYPE=CELL:${c.mobile.trim()}`);
  if (c.email?.trim()) lines.push(`EMAIL:${c.email.trim()}`);
  if (c.url?.trim()) lines.push(`URL:${c.url.trim()}`);
  if ([c.street, c.city, c.zip, c.country].some((s) => s?.trim())) lines.push(`ADR;TYPE=WORK:;;${v(c.street)};${v(c.city)};;${v(c.zip)};${v(c.country)}`);
  if (c.note?.trim()) lines.push(`NOTE:${v(c.note)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

/** geo: URI, or null when the coordinates are out of range. */
export function geoPayload(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);
  return `geo:${fmt(lat)},${fmt(lng)}`;
}
