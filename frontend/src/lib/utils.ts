import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DEFAULT_TZ = "Asia/Dhaka";

function safeTz(tz?: string) {
  return tz || DEFAULT_TZ;
}

/** "17 Nov 2026, 14:30" in the owner's timezone. */
export function fmtDateTime(isoDate: string | null | undefined, tz?: string) {
  if (!isoDate) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: safeTz(tz) }).format(new Date(isoDate));
}

export function fmtDate(isoDate: string | null | undefined, tz?: string) {
  if (!isoDate) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: safeTz(tz) }).format(new Date(isoDate));
}

export function fmtTime(isoDate: string | null | undefined, tz?: string) {
  if (!isoDate) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: safeTz(tz) }).format(new Date(isoDate));
}

/** "in 3 hours", "2 days ago". */
export function fmtRelative(isoDate: string | null | undefined) {
  if (!isoDate) return "—";
  const diff = Date.parse(isoDate) - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return diff >= 0 ? "in a moment" : "just now";
}

export function fmtMoney(n: number | null | undefined, currency = "USD", digits = 2) {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) }).format(n);
  } catch {
    return `${n.toFixed(digits)} ${currency}`;
  }
}

export function fmtNumber(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtCompact(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function humanize(s: string) {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Convert an ISO instant to the value of an <input type="datetime-local"> in a timezone. */
export function toLocalInput(isoDate: string | null | undefined, tz?: string) {
  if (!isoDate) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeTz(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoDate));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Interpret a datetime-local value as wall-clock time in `tz` and return an ISO UTC instant. */
export function fromLocalInput(value: string, tz?: string): string | null {
  if (!value) return null;
  const [d, t] = value.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = (t ?? "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  // offset of tz at that instant
  const asTz = new Date(toLocalInput(new Date(guess).toISOString(), tz) + ":00Z").getTime();
  const offset = asTz - guess;
  return new Date(guess - offset).toISOString();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
