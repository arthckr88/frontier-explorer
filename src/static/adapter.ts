import { greatCircleArc, reachable } from "@/lib/graph/arcs";
import { searchItineraries, type FlightSegment } from "@/lib/graph/search";
import { untimedPaths, type UntimedPath } from "@/lib/graph/untimed";
import { isRedEyeSegment } from "@/lib/time/redeye";
import type { BrowserFareRecord } from "@/site/network";
import type { MapAirport, MapRoute } from "@/server/queries/read";
import type {
  AirportRecord,
  DisplayFare,
  FareLookupResult,
  FareQuery,
  PriceHistoryRow,
  StaticCatalog,
  StoredFlight,
} from "@/static/types";

const INTEREST = ["OAK", "SFO", "LAS", "LAX", "BUR"];
const TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";

export type ChromeLink = { href: string; label: string };

export type HomeModule = {
  airports: { iata: string; city: string }[];
  bayLa: UntimedPath[];
  bayNy: UntimedPath[];
  florida: UntimedPath[];
  floridaAirports: { iata: string; city: string }[];
  changes: { href: string; summary: string }[];
  scheduleThrough: string;
};

export type NetworkModel = {
  routes: MapRoute[];
  airports: MapAirport[];
  interest: string[];
  tileStyle: string;
  home: HomeModule;
  confirmedPairs: number;
};

type Quote = { available?: boolean; total?: number | null; display?: number | null; currency?: string | null } | null;

export function displayFare(quote: Quote): DisplayFare | null {
  if (!quote || quote.available === false) return null;
  if (quote.total == null || quote.display == null) return null;
  if (!Number.isFinite(quote.total) || !Number.isFinite(quote.display)) return null;
  if (quote.total < 0 || quote.display < 0) return null;
  return { total: quote.total, display: quote.display, currency: quote.currency || "USD" };
}

function airportIndex(catalog: StaticCatalog) {
  return new Map(catalog.airports.map((airport) => [airport.iata, airport]));
}

function pairKey(origin: string, destination: string) {
  return `${origin}|${destination}`;
}

export function confirmedEdges(catalog: StaticCatalog) {
  const edges = new Map<string, { origin: string; destination: string }>();
  for (const flight of catalog.network.observations) {
    edges.set(pairKey(flight.origin, flight.destination), { origin: flight.origin, destination: flight.destination });
  }
  return [...edges.values()];
}

export function staticNetworkAdapter(catalog: StaticCatalog): NetworkModel {
  const points = airportIndex(catalog);
  const edges = confirmedEdges(catalog);
  const routes: MapRoute[] = [];
  for (const edge of edges) {
    const origin = points.get(edge.origin);
    const destination = points.get(edge.destination);
    if (!origin || !destination) continue;
    routes.push({
      origin: edge.origin,
      destination: edge.destination,
      status: "ACTIVE",
      confidence: "HIGH",
      frequency: null,
      announcedFrequency: null,
      endConfirmed: false,
      originRegion: origin.region || "other",
      destinationRegion: destination.region || "other",
      international: origin.country !== "US" || destination.country !== "US",
      coordinates: greatCircleArc([origin.lon, origin.lat], [destination.lon, destination.lat]),
    });
  }
  const used = new Set(routes.flatMap((route) => [route.origin, route.destination]));
  for (const code of INTEREST) used.add(code);
  const airports = [...used]
    .map((code) => toMapAirport(points.get(code)))
    .filter((airport): airport is MapAirport => Boolean(airport));
  const graph = edges.map((edge) => ({ origin: edge.origin, destination: edge.destination, status: "nonstop", frequency: null }));
  const scheduleThrough = catalog.network.observations.reduce((max, flight) => (flight.date > max ? flight.date : max), "");
  const observedAirports = new Set(routes.flatMap((route) => [route.origin, route.destination]));
  const consumerChanges = travelerChanges(catalog);
  return {
    routes,
    airports,
    interest: INTEREST.filter((code) => points.has(code)),
    tileStyle: TILE_STYLE,
    confirmedPairs: edges.length,
    home: {
      airports: [...observedAirports]
        .map((code) => points.get(code))
        .filter((airport): airport is AirportRecord => Boolean(airport))
        .sort((a, b) => interestRank(a.iata) - interestRank(b.iata) || a.iata.localeCompare(b.iata))
        .map((airport) => ({ iata: airport.iata, city: airport.city })),
      bayLa: presentPaths(orderedPaths(catalog, graph, ["OAK", "SFO", "SJC"], ["LAX", "BUR", "SNA", "ONT", "SAN"], 2, true)),
      bayNy: orderedPaths(catalog, graph, ["OAK", "SFO"], ["LGA", "JFK"], 2).slice(0, 4),
      florida: orderedPaths(catalog, graph, ["OAK", "SFO", "LAS"], ["MCO", "FLL", "MIA"], 2).slice(0, 4),
      floridaAirports: ["MCO", "FLL", "MIA"]
        .map((code) => points.get(code))
        .filter((airport): airport is AirportRecord => {
          if (!airport) return false;
          return used.has(airport.iata);
        })
        .map((airport) => ({ iata: airport.iata, city: airport.city })),
      changes: consumerChanges,
      scheduleThrough,
    },
  };
}

function interestRank(code: string) {
  const index = INTEREST.indexOf(code);
  return index === -1 ? INTEREST.length : index;
}

function toMapAirport(airport: AirportRecord | undefined): MapAirport | null {
  if (!airport || !Number.isFinite(airport.lat) || !Number.isFinite(airport.lon)) return null;
  return {
    iata: airport.iata,
    name: airport.name,
    city: airport.city,
    latitude: airport.lat,
    longitude: airport.lon,
    timezone: airport.timezone,
    region: airport.region || "other",
    country: airport.country,
  };
}

export function staticChrome(catalog: StaticCatalog): { status: string; links: ChromeLink[] } {
  const network = staticNetworkAdapter(catalog);
  const through = network.home.scheduleThrough;
  const links: ChromeLink[] = [{ href: "/", label: "Search" }];
  if (network.confirmedPairs > 0) {
    links.push({ href: "/discover", label: "Discover" }, { href: "/planner", label: "Planner" });
  }
  if (catalog.changes.events.length > 0) links.push({ href: "/changes", label: "Changes" });
  if (storedGoWild(catalog).length > 0) links.push({ href: "/gowild", label: "GoWild" });
  links.push({ href: "/system/data", label: "Data" }, { href: "/settings", label: "Settings" });
  return {
    status: through ? `Schedule through ${formatDay(through)}.` : "No schedule yet.",
    links,
  };
}

export function staticFareLookup(catalog: StaticCatalog, query: FareQuery): FareLookupResult {
  const origin = query.origin.trim().toUpperCase();
  const destination = query.destination.trim().toUpperCase();
  const date = query.date.trim();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { flights: [], message: "Enter two different airport codes and a date." };
  }
  const zones = airportIndex(catalog);
  const fares = catalog.fares.filter((fare) => fare.origin === origin && fare.destination === destination && fare.date === date);
  const observations = catalog.network.observations.filter(
    (flight) => flight.origin === origin && flight.destination === destination && flight.date === date,
  );
  const usedFares = new Set<BrowserFareRecord>();
  const flights: StoredFlight[] = [];
  for (const flight of observations) {
    const fare = fares.find((item) => !usedFares.has(item) && sameNonstop(item, flight));
    if (fare) usedFares.add(fare);
    flights.push(toStoredFlight(flight, fare ?? null, zones));
  }
  for (const fare of fares) {
    if (usedFares.has(fare)) continue;
    flights.push(fareToStoredFlight(fare, zones));
  }
  if (flights.length === 0) {
    return { flights: [], message: "No Frontier schedule for this date." };
  }
  const filtered = flights.filter((flight) => keepFlight(flight, query));
  filtered.sort((a, b) => compareFlights(a, b, query.sort));
  if (filtered.length === 0) return { flights: [], message: "No flights match these filters." };
  return { flights: filtered, message: null };
}

function sameNonstop(
  fare: BrowserFareRecord,
  flight: { flightNumber: string; departureLocal: string },
) {
  if ((fare.stops ?? 0) > 0) return false;
  return fare.flightNumber === flight.flightNumber && fare.departureLocal.slice(0, 16) === flight.departureLocal.slice(0, 16);
}

function toStoredFlight(
  flight: StaticCatalog["network"]["observations"][number],
  fare: BrowserFareRecord | null,
  zones: Map<string, AirportRecord>,
): StoredFlight {
  const duration = durationMinutes(flight.departureUtc, flight.arrivalUtc) || fare?.durationMinutes || 0;
  return {
    id: `${flight.date}|${flight.flightNumber}|${flight.departureLocal}|0`,
    origin: flight.origin,
    destination: flight.destination,
    date: flight.date,
    flightNumber: flight.flightNumber,
    departureLocal: flight.departureLocal,
    arrivalLocal: flight.arrivalLocal,
    durationMinutes: duration,
    stops: 0,
    standard: displayFare(fare?.standard ?? null),
    discountDen: displayFare(fare?.discountDen ?? null),
    goWild: displayFare(fare?.goWild ?? null),
    checkedAt: fare?.retrievedAt ?? null,
    redEye: redEye(flight.departureLocal, flight.arrivalLocal, zones.get(flight.origin)?.timezone, zones.get(flight.destination)?.timezone),
  };
}

function fareToStoredFlight(fare: BrowserFareRecord, zones: Map<string, AirportRecord>): StoredFlight {
  return {
    id: `${fare.date}|${fare.flightNumber}|${fare.departureLocal}|${fare.arrivalLocal}|${fare.stops ?? 0}`,
    origin: fare.origin,
    destination: fare.destination,
    date: fare.date,
    flightNumber: fare.flightNumber,
    departureLocal: fare.departureLocal,
    arrivalLocal: fare.arrivalLocal,
    durationMinutes: fare.durationMinutes ?? 0,
    stops: fare.stops ?? 0,
    standard: displayFare(fare.standard),
    discountDen: displayFare(fare.discountDen),
    goWild: displayFare(fare.goWild),
    checkedAt: fare.retrievedAt,
    redEye: redEye(fare.departureLocal, fare.arrivalLocal, zones.get(fare.origin)?.timezone, zones.get(fare.destination)?.timezone),
  };
}

function durationMinutes(departureUtc: string, arrivalUtc: string) {
  const ms = Date.parse(arrivalUtc) - Date.parse(departureUtc);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 60000);
}

function redEye(departureLocal: string, arrivalLocal: string, originTimezone?: string | null, destinationTimezone?: string | null) {
  if (!originTimezone || !destinationTimezone) return false;
  return isRedEyeSegment({ departureLocal, arrivalLocal, originTimezone, destinationTimezone });
}

function keepFlight(flight: StoredFlight, query: FareQuery) {
  if (flight.stops > query.maxStops) return false;
  if (query.maxDuration != null && flight.durationMinutes > query.maxDuration) return false;
  if (query.depart && bucket(flight.departureLocal) !== query.depart) return false;
  if (query.arrive && bucket(flight.arrivalLocal) !== query.arrive) return false;
  if (query.excludeRedEyes && flight.redEye) return false;
  return true;
}

function bucket(local: string): "morning" | "afternoon" | "evening" | "" {
  const hour = Number(local.slice(11, 13));
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "";
}

function compareFlights(a: StoredFlight, b: StoredFlight, sort: FareQuery["sort"]) {
  if (sort === "duration") return a.durationMinutes - b.durationMinutes || a.departureLocal.localeCompare(b.departureLocal);
  if (sort === "depart") return a.departureLocal.localeCompare(b.departureLocal);
  return a.stops - b.stops || a.departureLocal.localeCompare(b.departureLocal);
}

export function staticAirportDetail(catalog: StaticCatalog, iata: string) {
  const code = iata.trim().toUpperCase();
  const airport = airportIndex(catalog).get(code);
  if (!airport) return null;
  const outbound = confirmedEdges(catalog)
    .filter((edge) => edge.origin === code)
    .map((edge) => {
      const next = catalog.network.observations
        .filter((flight) => flight.origin === edge.origin && flight.destination === edge.destination)
        .sort((a, b) => a.departureLocal.localeCompare(b.departureLocal))[0];
      return {
        origin: edge.origin,
        destination: edge.destination,
        next: next ? `${formatDay(next.date)} · ${clock(next.departureLocal)}` : null,
      };
    });
  return { airport, outbound };
}

export function staticRouteDetail(catalog: StaticCatalog, origin: string, destination: string) {
  const from = origin.trim().toUpperCase();
  const to = destination.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const points = airportIndex(catalog);
  if (!points.has(from) || !points.has(to)) return null;
  const observations = catalog.network.observations
    .filter((flight) => flight.origin === from && flight.destination === to)
    .sort((a, b) => a.departureLocal.localeCompare(b.departureLocal));
  const fares = catalog.fares.filter((fare) => fare.origin === from && fare.destination === to);
  const days = [...new Set(observations.map((flight) => flight.date))].sort();
  const schedule = days.map((date) => {
    const lookup = staticFareLookup(catalog, {
      origin: from,
      destination: to,
      date,
      maxStops: 0,
      maxDuration: null,
      depart: "",
      arrive: "",
      sort: "depart",
      excludeRedEyes: false,
    });
    return { date, flights: lookup.flights };
  });
  const history = catalog.priceHistory
    .filter((row) => row.origin === from && row.destination === to && row.price >= 0)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const changes = catalog.changes.events.filter((event) => event.origin === from && event.destination === to);
  return {
    origin: from,
    destination: to,
    originCity: points.get(from)?.city ?? from,
    destinationCity: points.get(to)?.city ?? to,
    schedule,
    fareDates: [...new Set(fares.map((fare) => fare.date))].sort(),
    history,
    changes,
    hasSchedule: observations.length > 0,
  };
}

export function staticPlanner(
  catalog: StaticCatalog,
  input: { origins: string[]; destinations: string[]; date: string; maxStops: number; excludeRedEyes: boolean },
) {
  const points = airportIndex(catalog);
  const end = addDays(input.date, 1) ?? input.date;
  const flights: FlightSegment[] = [];
  for (const flight of catalog.network.observations) {
    if (flight.date < input.date || flight.date > end) continue;
    const origin = points.get(flight.origin);
    const destination = points.get(flight.destination);
    if (!origin?.timezone || !destination?.timezone) continue;
    flights.push({
      id: `${flight.origin}-${flight.destination}-${flight.departureLocal}-${flight.flightNumber}`,
      origin: flight.origin,
      destination: flight.destination,
      departureLocal: flight.departureLocal,
      arrivalLocal: flight.arrivalLocal,
      originTimezone: origin.timezone,
      destinationTimezone: destination.timezone,
      flightNumber: flight.flightNumber,
    });
  }
  const edges = confirmedEdges(catalog).map((edge) => ({
    origin: edge.origin,
    destination: edge.destination,
    status: "nonstop",
    frequency: null,
  }));
  const untimed = untimedPaths(edges, input.origins, input.destinations, input.maxStops).slice(0, 12);
  if (flights.length === 0) {
    return { itineraries: [], untimed, notice: "No Frontier schedule for this date." };
  }
  const itineraries = searchItineraries(flights, {
    origins: input.origins,
    destinations: input.destinations,
    date: input.date,
    maxStops: input.maxStops,
    minConnectionMinutes: 60,
    allowLongConnection: true,
    allowIntentionalStopover: true,
    allowMultiDay: false,
    excludeRedEyes: input.excludeRedEyes,
    maxJourneyHours: 36,
    preferVegasStopover: true,
    preferredOrigins: ["OAK"],
    preferredDestinations: ["LAX", "BUR", "LGA", "JFK", "MCO"],
  });
  return {
    itineraries,
    untimed,
    notice: itineraries.length === 0 ? "No flights connect these airports on this date." : null,
  };
}

export function staticChanges(catalog: StaticCatalog, windowDays: number | null, scope: "all" | "mine") {
  const today = catalog.network.today || catalog.network.observations.reduce((max, flight) => (flight.date > max ? flight.date : max), "");
  const interest = new Set(INTEREST);
  return catalog.changes.events
    .filter((event) => {
      if (windowDays != null && today) {
        const age = daysBetween(event.recordedOn, today);
        if (age > windowDays) return false;
      }
      if (scope === "mine") return interest.has(event.origin) || interest.has(event.destination);
      return true;
    })
    .map((event) => ({
      ...event,
      consumer: travelerChange(event),
    }));
}

const CHANGE_RANK: Record<string, number> = {
  new_observation: 0,
  service_reappeared: 1,
  schedule_extended: 2,
};

function travelerChanges(catalog: StaticCatalog) {
  return staticChanges(catalog, null, "all")
    .filter((change) => change.consumer)
    .sort(
      (a, b) =>
        (CHANGE_RANK[a.type] ?? 9) - (CHANGE_RANK[b.type] ?? 9) ||
        a.origin.localeCompare(b.origin) ||
        a.destination.localeCompare(b.destination),
    )
    .slice(0, 5)
    .map((change) => ({ href: `/routes/${change.origin}/${change.destination}`, summary: change.consumer as string }));
}

function travelerChange(event: { type: string; origin: string; destination: string; detail: string }) {
  const route = `${event.origin} → ${event.destination}`;
  if (event.type === "new_observation") return `New nonstop ${route}`;
  if (event.type === "service_reappeared") return `Service resumes ${route}`;
  if (event.type === "schedule_extended") {
    const match = /to (\d{4}-\d{2}-\d{2})/.exec(event.detail);
    const through = match?.[1];
    if (!through) return null;
    return `Schedule extended through ${formatDay(through)} · ${route}`;
  }
  return null;
}

function orderedPaths(
  catalog: StaticCatalog,
  graph: { origin: string; destination: string; status: string; frequency: number | null }[],
  origins: string[],
  destinations: string[],
  maxStops: number,
  futureNonstopsOnly = false,
) {
  const legs = shortestLegMinutes(catalog);
  const future = futureNonstopKeys(catalog);
  const seen = new Set<string>();
  const paths: UntimedPath[] = [];
  for (const path of untimedPaths(graph, origins, destinations, maxStops)) {
    const key = path.airports.join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    if (futureNonstopsOnly && path.stops === 0) {
      const origin = path.airports[0];
      const destination = path.airports[1];
      if (!origin || !destination || !future.has(pairKey(origin, destination))) continue;
    }
    paths.push(path);
  }
  paths.sort((a, b) => {
    if (a.stops !== b.stops) return a.stops - b.stops;
    const duration = pathMinutes(a, legs) - pathMinutes(b, legs);
    if (duration !== 0) return duration;
    return a.airports.join(">").localeCompare(b.airports.join(">"));
  });
  return paths;
}

function presentPaths(paths: UntimedPath[], connectionLimit = 3) {
  const nonstops = paths.filter((path) => path.stops === 0);
  const connections = paths.filter((path) => path.stops > 0).slice(0, connectionLimit);
  return [...nonstops, ...connections];
}

function futureNonstopKeys(catalog: StaticCatalog) {
  const today = catalog.network.today || "";
  const keys = new Set<string>();
  for (const flight of catalog.network.observations) {
    if (today && flight.date < today) continue;
    keys.add(pairKey(flight.origin, flight.destination));
  }
  return keys;
}

function shortestLegMinutes(catalog: StaticCatalog) {
  const minutes = new Map<string, number>();
  for (const flight of catalog.network.observations) {
    const elapsed = durationMinutes(flight.departureUtc, flight.arrivalUtc);
    if (elapsed <= 0) continue;
    const key = pairKey(flight.origin, flight.destination);
    const current = minutes.get(key);
    if (current == null || elapsed < current) minutes.set(key, elapsed);
  }
  return minutes;
}

function pathMinutes(path: UntimedPath, legs: Map<string, number>) {
  let total = 0;
  for (let index = 0; index < path.airports.length - 1; index += 1) {
    const origin = path.airports[index];
    const destination = path.airports[index + 1];
    if (!origin || !destination) return Number.MAX_SAFE_INTEGER;
    const minutes = legs.get(pairKey(origin, destination));
    if (minutes == null) return Number.MAX_SAFE_INTEGER;
    total += minutes;
  }
  return total;
}

export function staticDiscover(catalog: StaticCatalog, from: string, maxStops: number) {
  const code = from.trim().toUpperCase();
  const edges = confirmedEdges(catalog).map((edge) => ({ origin: edge.origin, destination: edge.destination, status: "nonstop" }));
  const reached = reachable([code], edges, maxStops);
  const points = airportIndex(catalog);
  const groups = [0, 1, 2]
    .filter((stop) => stop <= maxStops)
    .map((stop) => ({
      stop,
      items: [...reached.entries()]
        .filter(([, value]) => value.stops === stop)
        .map(([iata]) => ({ iata, city: points.get(iata)?.city ?? "" }))
        .sort((a, b) => a.iata.localeCompare(b.iata)),
    }));
  return { from: code, groups };
}

export type GoWildFare = {
  origin: string;
  destination: string;
  date: string;
  flightNumber: string;
  departureLocal: string;
  arrivalLocal: string;
  goWild: DisplayFare;
  checkedAt: string;
};

export function storedGoWild(catalog: StaticCatalog): GoWildFare[] {
  const rows: GoWildFare[] = [];
  for (const fare of catalog.fares) {
    const goWild = displayFare(fare.goWild);
    if (!goWild) continue;
    rows.push({
      origin: fare.origin,
      destination: fare.destination,
      date: fare.date,
      flightNumber: fare.flightNumber,
      departureLocal: fare.departureLocal,
      arrivalLocal: fare.arrivalLocal,
      goWild,
      checkedAt: fare.retrievedAt,
    });
  }
  rows.sort((a, b) => a.departureLocal.localeCompare(b.departureLocal) || a.flightNumber.localeCompare(b.flightNumber));
  return rows;
}

export function staticDiagnostics(catalog: StaticCatalog) {
  const checks = catalog.network.checks ?? [];
  const count = (state: string) => checks.filter((check) => check.state === state).length;
  const dates = catalog.network.observations.map((flight) => flight.date).sort();
  return {
    source: catalog.network.source,
    sourceUrl: catalog.network.sourceUrl,
    observations: catalog.network.observations.length,
    confirmedPairs: confirmedEdges(catalog).length,
    listedCandidates: catalog.network.candidateCount,
    fares: catalog.fares.length,
    priceHistory: catalog.priceHistory.length,
    scheduleStart: dates[0] ?? null,
    scheduleThrough: dates[dates.length - 1] ?? null,
    flightsFound: count("flights_found"),
    empty: count("checked_empty"),
    blocked: count("blocked"),
    unchecked: count("unchecked"),
    changes: catalog.changes.events.length,
  };
}

export function formatDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

export function clock(local: string) {
  const match = /T(\d{2}):(\d{2})/.exec(local);
  if (!match) return local;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

export function formatElapsed(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function formatChecked(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function fareText(fare: DisplayFare | null) {
  if (!fare) return "";
  return `$${fare.display} · $${fare.total.toFixed(2)} exact`;
}

export function calendarToday(timeZone = "America/Los_Angeles", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(iso: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(earlier: string, later: string) {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function historyFare(row: PriceHistoryRow) {
  if (row.price < 0) return null;
  return row;
}
