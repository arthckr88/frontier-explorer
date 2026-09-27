import { DateTime } from "luxon";

/** Schedule "today" and local-to-UTC conversion. Luxon is the only date library. */
export const SCHEDULE_ZONE = "America/Los_Angeles";

export function scheduleToday(now: DateTime = DateTime.now()): string {
  const iso = now.setZone(SCHEDULE_ZONE).toISODate();
  if (!iso) throw new Error("Could not resolve the schedule date.");
  return iso;
}

export function localToUtc(local: string, zone: string): string | null {
  if (!zone) return null;
  const value = DateTime.fromISO(local, { zone });
  if (!value.isValid) return null;
  return value.toUTC().toISO({ suppressMilliseconds: true });
}

export function utcToLocal(utc: string, zone: string): string | null {
  if (!zone) return null;
  const parsed = DateTime.fromISO(utc, { zone: "utc" });
  if (!parsed.isValid) return null;
  const local = parsed.setZone(zone);
  if (!local.isValid) return null;
  return local.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

export function zonedMinutes(startLocal: string, startZone: string, endLocal: string, endZone: string): number {
  const start = DateTime.fromISO(startLocal, { zone: startZone });
  const end = DateTime.fromISO(endLocal, { zone: endZone });
  if (!start.isValid || !end.isValid) return Number.NaN;
  return end.toUTC().diff(start.toUTC(), "minutes").minutes;
}
