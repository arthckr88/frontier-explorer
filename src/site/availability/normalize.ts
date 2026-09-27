import type { AvailabilityFlight, AvailabilitySegment, FareQuote, OtherFare } from "@/site/availability/types";

/**
 * Paths read from a Frontier availability payload.
 * The 2026-09-28 OAK→LAS call returned an empty body, so none of these paths were observed live.
 * Mobile names come from the reference client's fare reader. Historic names are the flat booking fields.
 */
export const AVAILABILITY_FIELD_PATHS = {
  flightList: ["<array>", "flights", "journeys[].flights", "data.flights", "data.journeys[].flights"],
  departureTime: ["departTime", "departureTime", "segments[].designator.departure", "legs[].departureDate"],
  arrivalTime: ["arriveTime", "arrivalTime", "segments[].designator.arrival", "legs[].arrivalDate"],
  stops: ["stops", "segments.length - 1", "legs.length - 1"],
  segments: ["segments[]", "legs[]"],
  segmentOrigin: ["segments[].designator.origin", "legs[].departureStation"],
  segmentDestination: ["segments[].designator.destination", "legs[].arrivalStation"],
  segmentFlightNumber: ["segments[].identifier.identifier", "segments[].flightNumber", "legs[].flightNumber", "flightNumber"],
  standardAmount: ["fares[].fareBundleInfo[standardfareAvailabilityKey].economyBundlePrice", "standardFare"],
  goWildAmount: ["fares[].fareBundleInfo[gowildfareAvailabilityKey].economyBundlePrice", "goWildFare"],
  goWildSeats: ["fares[].fareBundleInfo[gowildfareAvailabilityKey].seatsRemaining", "goWildFareSeatsRemaining"],
  discountDenAmount: [
    "fares[].fareBundleInfo[discountdenfareAvailabilityKey].economyBundlePrice",
    "discountDenFare",
  ],
  discountDenSeats: ["fares[].fareBundleInfo[discountdenfareAvailabilityKey].seatsRemaining", "discountDenFareSeatsRemaining"],
  currency: ["fareBundleInfo[key].currencyCode", "fareBundleInfo[key].currency"],
} as const;

const DISCOUNT_DEN_KEYS = [
  "discountdenfareAvailabilityKey",
  "discountDenfareAvailabilityKey",
  "discountDenFareAvailabilityKey",
] as const;

export function unknownFare(): FareQuote {
  return { amount: null, currency: null, seatsRemaining: null };
}

export function normalizeAvailabilityPayload(payload: unknown): { ok: true; flights: AvailabilityFlight[] } | { ok: false } {
  const list = flightList(payload);
  if (!list) return { ok: false };
  const flights: AvailabilityFlight[] = [];
  for (const item of list) {
    if (!isRecord(item)) return { ok: false };
    flights.push(normalizeFlight(item));
  }
  return { ok: true, flights };
}

function flightList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;
  if (Array.isArray(payload.flights)) return payload.flights;
  const fromJourneys = flightsFromJourneys(payload.journeys);
  if (fromJourneys) return fromJourneys;
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.flights)) return payload.data.flights;
    const nested = flightsFromJourneys(payload.data.journeys);
    if (nested) return nested;
  }
  if ("flights" in payload || "journeys" in payload || "data" in payload) return null;
  if (isRecord(payload) && looksLikeFlight(payload)) return [payload];
  return null;
}

function flightsFromJourneys(journeys: unknown): unknown[] | null {
  if (!Array.isArray(journeys)) return null;
  const flights: unknown[] = [];
  for (const journey of journeys) {
    if (!isRecord(journey) || !Array.isArray(journey.flights)) return null;
    flights.push(...journey.flights);
  }
  return flights;
}

function looksLikeFlight(raw: Record<string, unknown>): boolean {
  return "departTime" in raw || "departureTime" in raw || "fares" in raw || "legs" in raw || "segments" in raw || "goWildFare" in raw;
}

function normalizeFlight(raw: Record<string, unknown>): AvailabilityFlight {
  const segments = readSegments(raw);
  const quotes = readFares(raw);
  const flightNumber = text(raw.flightNumber) ?? segments.find((segment) => segment.flightNumber)?.flightNumber ?? null;
  return {
    flightNumber,
    departureTime: text(raw.departTime) ?? text(raw.departureTime) ?? segments[0]?.departureTime ?? null,
    arrivalTime: text(raw.arriveTime) ?? text(raw.arrivalTime) ?? segments.at(-1)?.arrivalTime ?? null,
    stops: readStops(raw, segments),
    segments,
    standard: quotes.standard,
    discountDen: quotes.discountDen,
    goWild: quotes.goWild,
    otherFares: quotes.otherFares,
  };
}

function readSegments(raw: Record<string, unknown>): AvailabilitySegment[] {
  const source = Array.isArray(raw.segments) ? raw.segments : Array.isArray(raw.legs) ? raw.legs : [];
  return source.filter(isRecord).map(readSegment);
}

function readSegment(raw: Record<string, unknown>): AvailabilitySegment {
  const designator = isRecord(raw.designator) ? raw.designator : null;
  const identifier = isRecord(raw.identifier) ? raw.identifier : null;
  const carrier = text(identifier?.carrierCode);
  const number = text(identifier?.identifier) ?? text(raw.flightNumber);
  return {
    origin: text(designator?.origin) ?? text(raw.departureStation) ?? text(raw.origin),
    destination: text(designator?.destination) ?? text(raw.arrivalStation) ?? text(raw.destination),
    flightNumber: number == null ? null : carrier ? `${carrier} ${number}` : number,
    departureTime: text(designator?.departure) ?? text(raw.departureDate) ?? text(raw.departTime),
    arrivalTime: text(designator?.arrival) ?? text(raw.arrivalDate) ?? text(raw.arriveTime),
  };
}

function readStops(raw: Record<string, unknown>, segments: AvailabilitySegment[]): number | null {
  if (typeof raw.stops === "number" && Number.isFinite(raw.stops)) return raw.stops;
  if (typeof raw.stops === "string" && /^\d+$/.test(raw.stops)) return Number(raw.stops);
  if (segments.length > 0) return Math.max(0, segments.length - 1);
  return null;
}

function readFares(raw: Record<string, unknown>): {
  standard: FareQuote;
  discountDen: FareQuote;
  goWild: FareQuote;
  otherFares: OtherFare[];
} {
  const standard = unknownFare();
  const discountDen = unknownFare();
  const goWild = unknownFare();
  const otherFares: OtherFare[] = [];
  const fareObjects = Array.isArray(raw.fares) ? raw.fares.filter(isRecord) : [];
  for (const fare of fareObjects) {
    const bundleInfo = isRecord(fare.fareBundleInfo) ? fare.fareBundleInfo : null;
    const standardKey = text(fare.standardfareAvailabilityKey);
    const goWildKey = text(fare.gowildfareAvailabilityKey);
    const discountKey = DISCOUNT_DEN_KEYS.map((key) => text(fare[key])).find((key) => key != null) ?? null;
    const used = new Set([standardKey, goWildKey, discountKey].filter((key): key is string => key != null));
    if (bundleInfo && standardKey) fillQuote(standard, readBundle(bundleInfo[standardKey]));
    if (bundleInfo && goWildKey) fillQuote(goWild, readBundle(bundleInfo[goWildKey]));
    if (bundleInfo && discountKey) fillQuote(discountDen, readBundle(bundleInfo[discountKey]));
    if (!bundleInfo) continue;
    for (const [key, value] of Object.entries(bundleInfo)) {
      if (used.has(key)) continue;
      const quote = readBundle(value);
      if (!quote) continue;
      otherFares.push({ key, ...quote });
    }
  }
  fillAmount(goWild, raw.goWildFare);
  fillSeats(goWild, raw.goWildFareSeatsRemaining);
  fillAmount(standard, raw.standardFare);
  fillAmount(discountDen, raw.discountDenFare);
  fillSeats(discountDen, raw.discountDenFareSeatsRemaining);
  return { standard, discountDen, goWild, otherFares };
}

function readBundle(value: unknown): FareQuote | null {
  if (!isRecord(value)) return null;
  return {
    amount: amount(value.economyBundlePrice) ?? amount(value.price) ?? amount(value.total),
    currency: text(value.currencyCode) ?? text(value.currency),
    seatsRemaining: seats(value.seatsRemaining) ?? seats(value.availableSeats) ?? seats(value.seatCount),
  };
}

function fillQuote(target: FareQuote, source: FareQuote | null) {
  if (!source) return;
  if (target.amount == null && source.amount != null) target.amount = source.amount;
  if (target.currency == null && source.currency != null) target.currency = source.currency;
  if (target.seatsRemaining == null && source.seatsRemaining != null) target.seatsRemaining = source.seatsRemaining;
}

function fillAmount(target: FareQuote, value: unknown) {
  const next = amount(value);
  if (target.amount == null && next != null) target.amount = next;
}

function fillSeats(target: FareQuote, value: unknown) {
  const next = seats(value);
  if (target.seatsRemaining == null && next != null) target.seatsRemaining = next;
}

function amount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function seats(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
