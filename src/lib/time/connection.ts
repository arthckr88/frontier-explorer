import { DateTime } from "luxon";

export function zonedDateTime(localIso: string, timezone: string): DateTime {
  return DateTime.fromISO(localIso, { zone: timezone });
}

export function connectionMinutes(
  arrivalLocal: string,
  arrivalTimezone: string,
  departureLocal: string,
  departureTimezone: string,
): number {
  const arrival = zonedDateTime(arrivalLocal, arrivalTimezone);
  const departure = zonedDateTime(departureLocal, departureTimezone);
  if (!arrival.isValid || !departure.isValid) return Number.NaN;
  return departure.toUTC().diff(arrival.toUTC(), "minutes").minutes;
}

export function elapsedMinutes(
  departureLocal: string,
  departureTimezone: string,
  arrivalLocal: string,
  arrivalTimezone: string,
): number {
  const departure = zonedDateTime(departureLocal, departureTimezone);
  const arrival = zonedDateTime(arrivalLocal, arrivalTimezone);
  if (!departure.isValid || !arrival.isValid) return Number.NaN;
  return arrival.toUTC().diff(departure.toUTC(), "minutes").minutes;
}

export type ConnectionCategory =
  | "invalid"
  | "normal"
  | "long"
  | "intentional_stopover"
  | "multi_day";

export const CONNECTION_BOUNDS = {
  normalMaxMinutes: 4 * 60,
  longMaxMinutes: 8 * 60,
  stopoverMaxMinutes: 24 * 60,
  multiDayMaxMinutes: 72 * 60,
};

export function categorizeConnection(
  minutes: number,
  minConnectionMinutes: number,
): ConnectionCategory {
  if (!Number.isFinite(minutes) || minutes < minConnectionMinutes) return "invalid";
  if (minutes <= CONNECTION_BOUNDS.normalMaxMinutes) return "normal";
  if (minutes <= CONNECTION_BOUNDS.longMaxMinutes) return "long";
  if (minutes <= CONNECTION_BOUNDS.stopoverMaxMinutes) return "intentional_stopover";
  if (minutes <= CONNECTION_BOUNDS.multiDayMaxMinutes) return "multi_day";
  return "invalid";
}

export function categoryAllowed(
  category: ConnectionCategory,
  options: {
    allowLongConnection: boolean;
    allowIntentionalStopover: boolean;
    allowMultiDay: boolean;
  },
): boolean {
  if (category === "normal") return true;
  if (category === "long") return options.allowLongConnection;
  if (category === "intentional_stopover") return options.allowIntentionalStopover;
  if (category === "multi_day") return options.allowMultiDay;
  return false;
}

export function isOvernightGround(
  arrivalLocal: string,
  arrivalTimezone: string,
  departureLocal: string,
  departureTimezone: string,
  minutes: number,
): boolean {
  if (minutes < CONNECTION_BOUNDS.longMaxMinutes) return false;
  const arrival = zonedDateTime(arrivalLocal, arrivalTimezone);
  const departure = zonedDateTime(departureLocal, departureTimezone);
  if (!arrival.isValid || !departure.isValid) return false;
  const arrivalDate = arrival.toISODate();
  const departureDate = departure.toISODate();
  return Boolean(arrivalDate && departureDate && departureDate > arrivalDate);
}
