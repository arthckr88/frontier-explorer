import { AVAILABILITY_SOURCE, type AvailabilityFlight, type AvailabilitySearchResult, type FareQuote } from "@/site/availability/types";

export type FareClass = "standard" | "discountDen" | "goWild" | "other";

export type PriceHistoryRecord = {
  key: string;
  origin: string;
  destination: string;
  date: string;
  flightNumber: string | null;
  departureTime: string | null;
  fareClass: FareClass;
  otherKey: string | null;
  amount: number;
  currency: string | null;
  seatsRemaining: number | null;
  retrievedAt: string;
  source: typeof AVAILABILITY_SOURCE;
};

export function priceHistoryFrom(result: AvailabilitySearchResult, retrievedAt: string): PriceHistoryRecord[] {
  if (result.status !== "ok") return [];
  const records: PriceHistoryRecord[] = [];
  for (const flight of result.flights) {
    pushQuote(records, result, flight, "standard", null, flight.standard, retrievedAt);
    pushQuote(records, result, flight, "discountDen", null, flight.discountDen, retrievedAt);
    pushQuote(records, result, flight, "goWild", null, flight.goWild, retrievedAt);
    for (const fare of flight.otherFares) {
      pushQuote(records, result, flight, "other", fare.key, fare, retrievedAt);
    }
  }
  return records;
}

function pushQuote(
  records: PriceHistoryRecord[],
  result: AvailabilitySearchResult,
  flight: AvailabilityFlight,
  fareClass: FareClass,
  otherKey: string | null,
  quote: FareQuote,
  retrievedAt: string,
) {
  if (quote.amount == null) return;
  const identity = `${flight.flightNumber ?? ""}|${flight.departureTime ?? ""}`;
  records.push({
    key: `${result.origin}|${result.destination}|${result.date}|${identity}|${fareClass}|${otherKey ?? ""}`,
    origin: result.origin,
    destination: result.destination,
    date: result.date,
    flightNumber: flight.flightNumber,
    departureTime: flight.departureTime,
    fareClass,
    otherKey,
    amount: quote.amount,
    currency: quote.currency,
    seatsRemaining: quote.seatsRemaining,
    retrievedAt,
    source: AVAILABILITY_SOURCE,
  });
}
