export type FareSegment = {
  carrier: string | null;
  flightNumber: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
};

export type ItineraryCompleteness = "complete" | "legacy_partial_itinerary";

export type FareItineraryInput = {
  queryOrigin?: string;
  queryDestination?: string;
  origin: string;
  destination: string;
  date: string;
  carrier: string | null;
  flightNumber: string;
  departureLocal: string;
  arrivalLocal: string;
  stops: number | null;
  segments?: FareSegment[];
  completeness?: ItineraryCompleteness;
  itineraryId?: string;
};

export function isCompleteItinerary(input: {
  queryOrigin: string;
  queryDestination: string;
  stops: number | null;
  segments: FareSegment[];
}): boolean {
  const stops = input.stops ?? 0;
  const segments = input.segments;
  if (stops < 0 || segments.length === 0 || segments.length !== stops + 1) return false;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return false;
  if (first.origin !== input.queryOrigin || last.destination !== input.queryDestination) return false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment?.flightNumber || !segment.origin || !segment.destination || !segment.departureLocal || !segment.arrivalLocal) return false;
    if (index > 0 && segments[index - 1]?.destination !== segment.origin) return false;
  }
  return true;
}

export function buildItineraryId(input: {
  queryOrigin: string;
  queryDestination: string;
  date: string;
  departureLocal: string;
  arrivalLocal: string;
  flightNumber: string;
  segments: FareSegment[];
  complete: boolean;
}): string {
  if (!input.complete) {
    return ["legacy_partial_itinerary", input.queryOrigin, input.queryDestination, input.date, input.flightNumber, input.departureLocal, input.arrivalLocal].join("|");
  }
  const airports = [input.segments[0]?.origin, ...input.segments.map((segment) => segment.destination)].filter(Boolean).join(">");
  const numbers = input.segments.map((segment) => segment.flightNumber).join("+");
  return [input.queryOrigin, input.queryDestination, input.date, airports, numbers, input.departureLocal, input.arrivalLocal].join("|");
}

export function normalizeFareItinerary<T extends FareItineraryInput>(fare: T): T & {
  queryOrigin: string;
  queryDestination: string;
  segments: FareSegment[];
  completeness: ItineraryCompleteness;
  itineraryId: string;
} {
  const queryOrigin = fare.queryOrigin || fare.origin;
  const queryDestination = fare.queryDestination || fare.destination;
  const stops = fare.stops ?? 0;
  let segments = fare.segments ?? [];
  if (segments.length === 0 && stops === 0 && fare.flightNumber && fare.origin && fare.destination && fare.departureLocal && fare.arrivalLocal) {
    segments = [
      {
        carrier: fare.carrier,
        flightNumber: fare.flightNumber,
        origin: queryOrigin,
        destination: queryDestination,
        departureLocal: fare.departureLocal,
        arrivalLocal: fare.arrivalLocal,
      },
    ];
  }
  const complete = isCompleteItinerary({ queryOrigin, queryDestination, stops, segments });
  const kept = complete ? segments : [];
  return {
    ...fare,
    queryOrigin,
    queryDestination,
    segments: kept,
    completeness: complete ? "complete" : "legacy_partial_itinerary",
    itineraryId: buildItineraryId({
      queryOrigin,
      queryDestination,
      date: fare.date,
      departureLocal: fare.departureLocal,
      arrivalLocal: fare.arrivalLocal,
      flightNumber: fare.flightNumber,
      segments: kept,
      complete,
    }),
  };
}

export function viaAirports(segments: FareSegment[]): string[] {
  return segments.slice(0, -1).map((segment) => segment.destination);
}
