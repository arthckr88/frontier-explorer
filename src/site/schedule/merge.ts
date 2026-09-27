import type { ScheduleProvenance } from "@/site/view";
import { datesBetween } from "@/site/view";

export type StoredFlight = {
  origin: string;
  destination: string;
  flightNumber: string;
  date: string;
  departureLocal: string;
  arrivalLocal: string;
  departureUtc: string;
  arrivalUtc: string;
  retrievedAt?: string | null;
  provenance?: ScheduleProvenance;
  corroboration?: boolean;
};

export type ScheduleWindowResult = {
  origin: string;
  destination: string;
  dateStart: string;
  dateEnd: string;
  complete: boolean;
  flights: StoredFlight[];
};

export type Disagreement = {
  origin: string;
  destination: string;
  date: string;
  flightNumber: string | null;
  kind: "time" | "booking_only" | "schedule_only" | "blocked_versus_schedule";
  detail: string;
};

export function mergeScheduleEvidence(
  store: { flights: StoredFlight[]; checked: string[]; blocked: string[] },
  windows: ScheduleWindowResult[],
): { flights: StoredFlight[]; checked: string[]; blocked: string[]; disagreements: Disagreement[] } {
  const flights = store.flights.map((flight) => ({ ...flight }));
  const disagreements: Disagreement[] = [];
  for (const window of windows) {
    const dates = coveredDates(window.dateStart, window.dateEnd);
    for (const date of dates) {
      const booking = flights.filter(
        (flight) =>
          flight.origin === window.origin &&
          flight.destination === window.destination &&
          flight.date === date &&
          (flight.provenance ?? "frontier_booking") === "frontier_booking" &&
          flight.corroboration !== true,
      );
      const scheduled = window.flights.filter((flight) => flight.date === date);
      const blocked = store.blocked.includes(`${window.origin}|${window.destination}|${date}`);
      for (const flight of scheduled) {
        const match = booking.find((item) => item.flightNumber === flight.flightNumber);
        if (!match) {
          flights.push({ ...flight, provenance: "flightaware_schedule" });
          if (blocked) {
            disagreements.push({
              origin: window.origin,
              destination: window.destination,
              date,
              flightNumber: flight.flightNumber,
              kind: "blocked_versus_schedule",
              detail: "Frontier booking was blocked. FlightAware published a schedule. Blocked stays blocked in the booking checks and was not turned into an empty check.",
            });
          } else if (booking.length === 0 && store.checked.includes(`${window.origin}|${window.destination}|${date}`)) {
            disagreements.push({
              origin: window.origin,
              destination: window.destination,
              date,
              flightNumber: flight.flightNumber,
              kind: "schedule_only",
              detail: "Frontier booking was checked empty. FlightAware published a flight. Both are kept.",
            });
          }
          continue;
        }
        if (minutesApart(match.departureUtc, flight.departureUtc) >= 15) {
          flights.push({ ...flight, provenance: "flightaware_schedule", corroboration: true });
          disagreements.push({
            origin: window.origin,
            destination: window.destination,
            date,
            flightNumber: flight.flightNumber,
            kind: "time",
            detail: `Booking departure ${match.departureLocal} and FlightAware departure ${flight.departureLocal} disagree. Both rows are kept.`,
          });
        }
      }
      if (!window.complete) continue;
      for (const flight of booking) {
        if (scheduled.some((item) => item.flightNumber === flight.flightNumber)) continue;
        disagreements.push({
          origin: window.origin,
          destination: window.destination,
          date,
          flightNumber: flight.flightNumber,
          kind: "booking_only",
          detail: "Frontier booking has this flight. The completed FlightAware window did not. The booking row is kept. This is not an empty check.",
        });
      }
    }
  }
  return {
    flights,
    checked: [...store.checked],
    blocked: [...store.blocked],
    disagreements,
  };
}

function coveredDates(start: string, end: string): string[] {
  const last = previousDate(end);
  if (!last || last < start) return [];
  return datesBetween(start, last);
}

function previousDate(iso: string): string | null {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function minutesApart(left: string, right: string): number {
  const delta = Math.abs(Date.parse(left) - Date.parse(right));
  if (!Number.isFinite(delta)) return 0;
  return delta / 60_000;
}
