export function formatClock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timezoneAbbrev(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("es-ES", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

export function formatDate(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone }).format(d);
}

/** A calendar date stored as `YYYY-MM-DD` (already in the guild's zone), e.g. a raid night. */
export function formatCalendarDate(ymd: string, style: "medium" | "full" = "medium"): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: style, timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
}

export function formatDateTime(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
}

/** The database stores "Deleted user" for redacted people (a trigger enforces the exact value); show it in Spanish. */
export const DELETED_USER = "Deleted user";
export const shownName = <T extends string | null | undefined>(name: T): T | string => (name === DELETED_USER ? "Usuario eliminado" : name);
