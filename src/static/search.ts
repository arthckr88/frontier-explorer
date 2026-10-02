import { calendarToday, staticFareLookup } from "@/static/adapter";
import { DateTime } from "luxon";
import { normalizeFareItinerary } from "@/site/itinerary";
import type { FareQuery, StaticCatalog, StoredFlight } from "@/static/types";

export const EMPTY_QUERY: FareQuery = { origin: "", destination: "", date: "", maxStops: 0, maxDuration: null, depart: "", arrive: "", sort: "stops", excludeRedEyes: true, via: "", layover: "" };
export const SETTINGS_KEY = "frontier-explorer-settings";
export const LAST_SEARCH_KEY = "frontier-explorer-last-search";
export type SearchSettings = { fareMode: "standard" | "discount_den" | "gowild"; excludeRedEyes: boolean; maxStops: number };
export const DEFAULT_SETTINGS: SearchSettings = { fareMode: "standard", excludeRedEyes: true, maxStops: 0 };

export function readSettings(): SearchSettings {
  try {
    const value = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
    return { fareMode: ["standard", "discount_den", "gowild"].includes(value.fareMode) ? value.fareMode : "standard", excludeRedEyes: typeof value.excludeRedEyes === "boolean" ? value.excludeRedEyes : true, maxStops: [0, 1, 2].includes(value.maxStops) ? value.maxStops : 0 };
  } catch { return DEFAULT_SETTINGS; }
}

export function parseSearchQuery(params: URLSearchParams): FareQuery | null {
  const origin = (params.get("from") || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin)) return null;
  const date = params.get("date") || "";
  const destination = (params.get("to") || "").trim().toUpperCase();
  if (destination && (!/^[A-Z]{3}$/.test(destination) || destination === origin)) return null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid)) return null;
  const duration = Number(params.get("duration"));
  return { ...EMPTY_QUERY, origin, destination, date, maxStops: [0, 1, 2].includes(Number(params.get("stops"))) ? Number(params.get("stops")) : 0,
    maxDuration: params.get("duration") && Number.isFinite(duration) && duration > 0 ? duration : null,
    depart: ["morning", "afternoon", "evening"].includes(params.get("depart") || "") ? params.get("depart") as FareQuery["depart"] : "",
    arrive: ["morning", "afternoon", "evening"].includes(params.get("arrive") || "") ? params.get("arrive") as FareQuery["arrive"] : "",
    sort: ["stops", "duration", "depart"].includes(params.get("sort") || "") ? params.get("sort") as FareQuery["sort"] : "stops",
    excludeRedEyes: params.get("redeye") !== "0", via: (params.get("via") || "").trim().toUpperCase(), layover: ["short", "normal", "long"].includes(params.get("layover") || "") ? params.get("layover") as FareQuery["layover"] : "" };
}

export function searchUrl(query: FareQuery): string {
  const params = new URLSearchParams({ from: query.origin, stops: String(query.maxStops), redeye: query.excludeRedEyes ? "1" : "0", sort: query.sort });
  for (const [key, value] of Object.entries({ to: query.destination, date: query.date, duration: query.maxDuration, depart: query.depart, arrive: query.arrive, via: query.via, layover: query.layover })) if (value) params.set(key, String(value));
  return `/?${params}`;
}

export function frontierSearchUrl(): string {
  return "https://www.flyfrontier.com/";
}

export function scheduleSourceUrl(origin: string, destination: string): string {
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) return "https://www.flightconnections.com/route-map-frontier-airlines-f9";
  return `https://www.flightconnections.com/flights-from-${origin.toLowerCase()}-to-${destination.toLowerCase()}#F9`;
}

export function flightResults(catalog: StaticCatalog, query: FareQuery) {
  const found = staticFareLookup(catalog, query);
  const actual = [...found.flights.filter((flight) => !flight.legacyPartial), ...found.paths.flatMap((path) => path.itinerary ? [path.itinerary] : [])];
  const unique = new Map<string, StoredFlight>();
  for (const flight of actual) {
    const key = (flight.segments?.length ? flight.segments.map((segment) => `${segment.origin}|${segment.destination}|${segment.flightNumber}|${segment.departureLocal}`).join(">") : `${flight.origin}|${flight.destination}|${flight.flightNumber}|${flight.departureLocal}`);
    const old = unique.get(key);
    if (!old || flight.standard || flight.discountDen || flight.goWild) unique.set(key, flight);
  }
  const flights = [...unique.values()].sort((a, b) => query.sort === "duration" ? a.durationMinutes - b.durationMinutes || a.departureLocal.localeCompare(b.departureLocal) : query.sort === "depart" ? a.departureLocal.localeCompare(b.departureLocal) : a.stops - b.stops || a.departureLocal.localeCompare(b.departureLocal));
  const completeKeys = new Set(flights.filter((flight) => flight.stops === 0).map((flight) => `${flight.flightNumber}|${flight.departureLocal.slice(0, 16)}`));
  const departures = airportDepartures(catalog, query).filter((flight) => !completeKeys.has(`${flight.flightNumber}|${flight.departureLocal.slice(0, 16)}`));
  return { ...found, flights, departures, paths: found.paths.filter((path) => path.kind === "possible") };
}

// Airport departure boards are useful evidence, but cannot create timed connections.
export function airportDepartures(catalog: StaticCatalog, query: FareQuery) {
  if (query.maxDuration != null || query.arrive || query.via || query.layover) return [];
  return (catalog.airportDepartures ?? []).filter((flight) => {
    if (flight.origin !== query.origin || flight.destination !== query.destination || flight.date !== query.date) return false;
    const hour = Number(flight.departureLocal.slice(11, 13));
    const bucket = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "";
    if (query.depart && query.depart !== bucket) return false;
    // With no arrival time, do not promise an overnight flight meets this preference.
    return !query.excludeRedEyes || Boolean(bucket);
  });
}

export function airportRoutesUrl(origin: string) {
  return origin === "PDX" ? "https://www.flypdx.com/NonstopDestinations" : "https://www.flightconnections.com/route-map-frontier-airlines-f9";
}

export function flightDates(catalog: StaticCatalog, query: FareQuery): string[] {
  const candidates = new Set(catalog.network.observations.filter((flight) => flight.origin === query.origin && (query.maxStops > 0 || flight.destination === query.destination)).map((flight) => flight.date));
  for (const fare of catalog.fares) if (fare.origin === query.origin && fare.destination === query.destination && normalizeFareItinerary(fare).completeness === "complete") candidates.add(fare.date);
  for (const flight of catalog.airportDepartures ?? []) if (flight.origin === query.origin && flight.destination === query.destination) candidates.add(flight.date);
  return [...candidates].sort().filter((date) => { const result = flightResults(catalog, { ...query, date }); return result.flights.length > 0 || result.departures.length > 0; });
}

export function dateStatus(catalog: StaticCatalog, query: FareQuery): "captured" | "departure_only" | "empty" | "unavailable" | "missing" {
  if (query.maxStops > 0 && flightResults(catalog, { ...EMPTY_QUERY, origin: query.origin, destination: query.destination, date: query.date, maxStops: query.maxStops, excludeRedEyes: false }).flights.length) return "captured";
  if (catalog.network.observations.some((flight) => flight.origin === query.origin && flight.destination === query.destination && flight.date === query.date) || catalog.fares.some((fare) => fare.origin === query.origin && fare.destination === query.destination && fare.date === query.date && normalizeFareItinerary(fare).completeness === "complete")) return "captured";
  if ((catalog.airportDepartures ?? []).some((flight) => flight.origin === query.origin && flight.destination === query.destination && flight.date === query.date)) return "departure_only";
  const checks = catalog.network.checks.filter((check) => check.origin === query.origin && check.destination === query.destination && check.date === query.date);
  if (checks.some((check) => check.state === "checked_empty")) return "empty";
  if (checks.some((check) => check.state === "blocked")) return "unavailable";
  return "missing";
}

export function suggestedFlights(catalog: StaticCatalog, today = calendarToday()) {
  const pairs = new Map<string, { origin: string; destination: string; date: string }>();
  for (const flight of [...catalog.network.observations].sort((a, b) => a.date.localeCompare(b.date))) if (flight.date >= today && !pairs.has(`${flight.origin}|${flight.destination}`)) pairs.set(`${flight.origin}|${flight.destination}`, { origin: flight.origin, destination: flight.destination, date: flight.date });
  for (const flight of catalog.airportDepartures ?? []) if (flight.date > today && !pairs.has(`${flight.origin}|${flight.destination}`)) pairs.set(`${flight.origin}|${flight.destination}`, { origin: flight.origin, destination: flight.destination, date: flight.date });
  const preferred = ["PDX", "OAK", "SFO", "LAS", "DEN"];
  return [...pairs.values()].sort((a, b) => (preferred.indexOf(a.origin) < 0 ? 99 : preferred.indexOf(a.origin)) - (preferred.indexOf(b.origin) < 0 ? 99 : preferred.indexOf(b.origin))).slice(0, 6);
}

export function resolveAirport(catalog: StaticCatalog, value: string): string {
  const text = value.trim();
  const code = text.toUpperCase().match(/(?:^|\()([A-Z]{3})\)?$/)?.[1];
  if (code && catalog.airports.some((airport) => airport.iata === code)) return code;
  const exact = catalog.airports.filter((airport) => airport.city.toLowerCase() === text.toLowerCase() || airport.name.toLowerCase() === text.toLowerCase());
  return exact.length === 1 ? exact[0]!.iata : "";
}
