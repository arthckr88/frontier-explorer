import { zonedDateTime } from "@/lib/time/connection";

export type RedEyeInput = {
  departureLocal: string;
  arrivalLocal: string;
  originTimezone: string;
  destinationTimezone: string;
};

/**
 * A segment is a red-eye when it substantially occupies the overnight window:
 * local departure from 22:00 through 05:00, or a flight that is airborne across
 * the night and arrives before 08:00 local. Ground time is not part of this.
 */
export function isRedEyeSegment(segment: RedEyeInput): boolean {
  const departure = zonedDateTime(segment.departureLocal, segment.originTimezone);
  const arrival = zonedDateTime(segment.arrivalLocal, segment.destinationTimezone);
  if (!departure.isValid || !arrival.isValid) return false;

  const departureMinutes = departure.hour * 60 + departure.minute;
  if (departureMinutes >= 22 * 60 || departureMinutes < 5 * 60) return true;

  const airborneHours = arrival.toUTC().diff(departure.toUTC(), "hours").hours;
  const arrivalDate = arrival.toISODate();
  const departureDate = departure.toISODate();
  const arrivesLaterLocalDay = Boolean(
    arrivalDate && departureDate && arrivalDate > departureDate,
  );
  const arrivalMinutes = arrival.hour * 60 + arrival.minute;
  return (
    airborneHours >= 3 &&
    arrivesLaterLocalDay &&
    arrivalMinutes < 8 * 60 &&
    departureMinutes >= 17 * 60
  );
}
