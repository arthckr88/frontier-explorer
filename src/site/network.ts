import {
  type Check,
  type Observation,
  PRIORITY_CORRIDORS,
  SOURCE_NAME,
  addDays,
  compareIso,
  datesBetween,
  describePair,
  isPriorityCorridor,
  pairKey,
  watchFor,
  type RouteSummary,
  type Watch,
} from "@/site/view";
import type { FareSegment, ItineraryCompleteness } from "@/site/itinerary";

const CHANGE_WINDOW_DAYS = 90;
const CHANGE_CAP = 80;

export type RouteChangeType =
  | "new_observation"
  | "schedule_extended"
  | "more_flights"
  | "fewer_flights"
  | "possible_gap"
  | "data_blocked"
  | "service_reappeared";

export type RouteChange = {
  id: string;
  type: RouteChangeType;
  origin: string;
  destination: string;
  recordedOn: string;
  detail: string;
};

export type PairSnapshot = {
  flights: string[];
  emptyDates: string[];
  blockedDates: string[];
};

export type RouteSnapshotFile = {
  pairs: Record<string, PairSnapshot>;
};

export type RouteChangeFile = {
  windowDays: number;
  events: RouteChange[];
};

export type NetworkArtifact = {
  source: string;
  sourceUrl: string;
  scheduleZone: string;
  today: string;
  lastRefresh: string | null;
  observations: Observation[];
  checks: Check[];
  summaries: RouteSummary[];
  watches: Watch[];
  candidateCount: number;
  confirmedPairCount: number;
  coveragePartial: boolean;
  fares?: BrowserFareRecord[];
  official?: OfficialNetwork;
};

export type OfficialNetwork = {
  retrievedAt: string;
  source: "Frontier official direct routes";
  sourceUrl: string;
  airports: string[];
  routes: {
    origin: string;
    destination: string;
    originCity: string;
    destinationCity: string;
    sourceUrl: string;
    provenance: "frontier_official_direct_route";
    nonstopEvidence?: { kind: "explicit_nonstop"; sourceUrl: string; retrievedAt: string };
  }[];
  unresolved: { originSlug: string; destinationSlug: string; originCity: string | null; destinationLabel: string; reason: string }[];
  candidateMarkets: number;
  lastBrowserCollection: string | null;
  fareModules?: { origin: string; embedded: number; total: number; lastPage: number; sourceUrl: string; named?: number; status?: "complete" | "blocked"; detail?: string }[];
  discrepancies?: { origin: string; destination: string; classification: "SCHEDULE_CONFIRMED_ONLY" | "IMPORTER_MISSED_ROUTE"; reason: string }[];
};

export type ScheduleInput = {
  flights?: Array<{
    origin: string;
    destination: string;
    flightNumber: string;
    date: string;
    departureLocal: string;
    arrivalLocal: string;
    departureUtc: string;
    arrivalUtc: string;
    retrievedAt?: string | null;
    provenance?: "frontier_booking" | "flightaware_schedule" | "frontier_newsroom" | "frontier_browser";
    corroboration?: boolean;
  }>;
  routes?: Array<{ origin: string; destination: string; provenance?: string }>;
  checked?: string[];
  blocked?: string[];
  refreshedAt?: string | null;
  browserFares?: BrowserFareRecord[];
};

export type BrowserFareRecord = {
  queryOrigin?: string;
  queryDestination?: string;
  origin: string;
  destination: string;
  date: string;
  itineraryId?: string;
  carrier: string | null;
  flightNumber: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number | null;
  stops: number | null;
  segments?: FareSegment[];
  completeness?: ItineraryCompleteness;
  standard: { available: boolean; total: number; display: number; currency: string | null } | null;
  discountDen: { available: boolean; total: number; display: number; currency: string | null } | null;
  goWild: { available: boolean; total: number; display: number; currency: string | null } | null;
  seatsRemaining: number | null;
  retrievedAt: string;
  source: "frontier_browser";
};

export type Diagnostic = {
  confirmedPairs: number;
  listedCandidates: number;
  futureFlights: number;
  checked: number;
  blocked: number;
  empty: number;
  unchecked: number;
  lastRetrieval: string | null;
  priorityIncomplete: Array<{ pair: string; reason: string }>;
};

const UTC_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function buildNetwork(schedule: ScheduleInput, today: string, official?: OfficialNetwork | null): NetworkArtifact {
  const refreshedAt = schedule.refreshedAt ?? null;
  const observations = normalizeObservations(schedule, refreshedAt);
  const checks = buildChecks(schedule, observations);
  const pairs = pairUniverse(schedule, observations, checks);
  const summaries = [...pairs]
    .sort()
    .map((key) => {
      const [origin, destination] = key.split("|");
      return describePair(origin ?? "", destination ?? "", observations, checks, today);
    });
  const watches = summaries.filter((summary) => isPriorityCorridor(summary.origin, summary.destination)).map(watchFor);
  const listed = (schedule.routes ?? []).filter((route) => route.provenance === "listed");
  const confirmed = new Set(observations.map((flight) => pairKey(flight.origin, flight.destination)));
  const fares = schedule.browserFares ?? [];
  return {
    source: SOURCE_NAME,
    sourceUrl: "https://booking.flyfrontier.com/",
    scheduleZone: "America/Los_Angeles",
    today,
    lastRefresh: refreshedAt,
    observations,
    checks,
    summaries,
    watches,
    candidateCount: listed.length,
    confirmedPairCount: confirmed.size,
    coveragePartial: watches.some((watch) => watch.signal !== "observed"),
    ...(fares.length ? { fares } : {}),
    ...(official && official.routes.length ? { official } : {}),
  };
}

export function normalizeObservations(schedule: ScheduleInput, refreshedAt: string | null): Observation[] {
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const flight of schedule.flights ?? []) {
    if (!flight?.origin || !flight.destination || !flight.date || !flight.flightNumber) continue;
    const token = `${flight.origin}|${flight.destination}|${flight.date}|${flight.flightNumber}|${flight.departureLocal}`;
    if (seen.has(token)) continue;
    seen.add(token);
    observations.push({
      origin: flight.origin,
      destination: flight.destination,
      date: flight.date,
      flightNumber: flight.flightNumber,
      departureLocal: flight.departureLocal,
      arrivalLocal: flight.arrivalLocal,
      departureUtc: flight.departureUtc,
      arrivalUtc: flight.arrivalUtc,
      source:
        flight.provenance === "flightaware_schedule"
          ? "FlightAware published schedule"
          : flight.provenance === "frontier_newsroom"
            ? "Announced by Frontier"
            : flight.provenance === "frontier_browser"
              ? "Frontier browser fare check"
              : SOURCE_NAME,
      retrievedAt: flight.retrievedAt ?? refreshedAt,
      ...(flight.provenance && flight.provenance !== "frontier_booking" ? { provenance: flight.provenance } : {}),
      ...(flight.corroboration ? { corroboration: true } : {}),
    });
  }
  observations.sort(compareObservations);
  return observations;
}

export function buildChecks(schedule: ScheduleInput, observations: Observation[]): Check[] {
  const flightDates = new Map<string, Set<string>>();
  for (const flight of observations) {
    const key = pairKey(flight.origin, flight.destination);
    const dates = flightDates.get(key) ?? new Set<string>();
    dates.add(flight.date);
    flightDates.set(key, dates);
  }
  const explicit = new Map<string, Check>();
  const remember = (origin: string, destination: string, date: string, state: Check["state"]) => {
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    explicit.set(`${origin}|${destination}|${date}`, { origin, destination, date, state });
  };
  for (const flight of observations) remember(flight.origin, flight.destination, flight.date, "flights_found");
  for (const key of schedule.checked ?? []) {
    const parsed = parseCheckKey(key);
    if (!parsed) continue;
    const hasFlight = flightDates.get(pairKey(parsed.origin, parsed.destination))?.has(parsed.date) ?? false;
    remember(parsed.origin, parsed.destination, parsed.date, hasFlight ? "flights_found" : "checked_empty");
  }
  for (const key of schedule.blocked ?? []) {
    const parsed = parseCheckKey(key);
    if (!parsed) continue;
    const id = `${parsed.origin}|${parsed.destination}|${parsed.date}`;
    if (explicit.has(id)) continue;
    remember(parsed.origin, parsed.destination, parsed.date, "blocked");
  }
  const byPair = new Map<string, Check[]>();
  for (const check of explicit.values()) {
    const key = pairKey(check.origin, check.destination);
    const list = byPair.get(key) ?? [];
    list.push(check);
    byPair.set(key, list);
  }
  const checks: Check[] = [];
  for (const [key, list] of byPair) {
    const dates = list.map((check) => check.date).sort(compareIso);
    const start = dates[0];
    const end = dates[dates.length - 1];
    const known = new Set(list.map((check) => check.date));
    if (start && end) {
      const [origin, destination] = key.split("|");
      for (const date of datesBetween(start, end)) {
        if (known.has(date)) continue;
        list.push({ origin: origin ?? "", destination: destination ?? "", date, state: "unchecked" });
      }
    }
    checks.push(...list);
  }
  checks.sort((left, right) => pairKey(left.origin, left.destination).localeCompare(pairKey(right.origin, right.destination)) || compareIso(left.date, right.date));
  return checks;
}

export function confirmedArcKeys(network: NetworkArtifact, today = network.today): string[] {
  return network.summaries
    .filter((summary) => summary.observedDates.some((date) => date >= today))
    .map((summary) => pairKey(summary.origin, summary.destination));
}

export function integrityErrors(schedule: ScheduleInput, network: NetworkArtifact): string[] {
  const errors: string[] = [];
  if (!network || !Array.isArray(network.observations) || !Array.isArray(network.checks) || !Array.isArray(network.summaries)) {
    return ["The production artifact is missing observations, checks, or summaries."];
  }
  if (network.source !== SOURCE_NAME) errors.push("Production source is not Frontier public booking observations.");
  const listed = new Set(
    (schedule.routes ?? [])
      .filter((route) => route.provenance === "listed")
      .map((route) => pairKey(route.origin, route.destination)),
  );
  const observationKeys = new Set(network.observations.map((flight) => pairKey(flight.origin, flight.destination)));
  for (const flight of network.observations) {
    if (!validStamp(flight.departureUtc) || !validStamp(flight.arrivalUtc)) {
      errors.push(`Invalid timestamp on ${flight.origin}-${flight.destination} ${flight.flightNumber} ${flight.date}.`);
      continue;
    }
    if (Date.parse(flight.arrivalUtc) <= Date.parse(flight.departureUtc)) {
      errors.push(`Arrival is not after departure on ${flight.origin}-${flight.destination} ${flight.flightNumber} ${flight.date}.`);
    }
    if (!flight.departureLocal.includes("T") || !flight.arrivalLocal.includes("T")) {
      errors.push(`Local time is missing on ${flight.origin}-${flight.destination} ${flight.flightNumber} ${flight.date}.`);
    }
  }
  for (const summary of network.summaries) {
    const key = pairKey(summary.origin, summary.destination);
    const flights = network.observations.filter((flight) => flight.origin === summary.origin && flight.destination === summary.destination);
    const upcoming = summary.observedDates.filter((date) => date >= network.today);
    if (upcoming.length && flights.length === 0) errors.push(`Confirmed arc ${key} has no booking observation.`);
    if (upcoming.length && listed.has(key) && flights.length === 0) errors.push(`Confirmed arc ${key} came only from a listed market.`);
    for (const date of summary.observedDates) {
      if (!flights.some((flight) => flight.date === date)) errors.push(`Summary date ${key} ${date} has no observation.`);
    }
    if (flights.length === 0 && listed.has(key) && summary.observedDates.length > 0) {
      errors.push(`Summary ${key} records dates without a booking observation.`);
    }
  }
  for (const arc of confirmedArcKeys(network)) {
    if (!observationKeys.has(arc)) errors.push(`Confirmed arc ${arc} has no booking observation.`);
    const [origin, destination] = arc.split("|");
    const onlyListed = listed.has(arc) && !network.observations.some((flight) => flight.origin === origin && flight.destination === destination);
    if (onlyListed) errors.push(`Confirmed arc ${arc} came only from a listed market.`);
  }
  for (const check of network.checks) {
    const flights = network.observations.filter(
      (flight) => flight.origin === check.origin && flight.destination === check.destination && flight.date === check.date,
    );
    if (check.state === "flights_found" && flights.length === 0) {
      errors.push(`Check ${check.origin}-${check.destination} ${check.date} says flight found without an observation.`);
    }
    if (check.state === "checked_empty" && flights.length > 0) {
      errors.push(`Check ${check.origin}-${check.destination} ${check.date} says empty but a flight is stored.`);
    }
  }
  const rebuilt = buildChecks(schedule, network.observations);
  if (rebuilt.length !== network.checks.length) {
    errors.push("Stored checks do not match the booking observations and check keys.");
  }
  return errors;
}

export function diagnostics(schedule: ScheduleInput, network: NetworkArtifact): Diagnostic {
  const listed = (schedule.routes ?? []).filter((route) => route.provenance === "listed").length;
  const priorityIncomplete: Array<{ pair: string; reason: string }> = [];
  for (const [origin, destination] of PRIORITY_CORRIDORS) {
    const summary = network.summaries.find((item) => item.origin === origin && item.destination === destination);
    if (!summary || (summary.observedDates.length === 0 && summary.emptyDates.length === 0 && summary.blockedDates.length === 0)) {
      priorityIncomplete.push({ pair: `${origin}-${destination}`, reason: "not checked yet" });
      continue;
    }
    if (summary.gapNote) priorityIncomplete.push({ pair: `${origin}-${destination}`, reason: "possible gap" });
    else if (summary.uncheckedDates.length) priorityIncomplete.push({ pair: `${origin}-${destination}`, reason: "unchecked dates inside the observed span" });
    else if (summary.blockedDates.length) priorityIncomplete.push({ pair: `${origin}-${destination}`, reason: "blocked dates remain unknown" });
    else if (summary.status === "unknown" || summary.status === "blocked") {
      priorityIncomplete.push({ pair: `${origin}-${destination}`, reason: summary.status });
    }
  }
  return {
    confirmedPairs: network.confirmedPairCount,
    listedCandidates: listed,
    futureFlights: network.observations.filter((flight) => flight.date >= network.today).length,
    checked: network.checks.filter((check) => check.state === "flights_found" || check.state === "checked_empty").length,
    blocked: network.checks.filter((check) => check.state === "blocked").length,
    empty: network.checks.filter((check) => check.state === "checked_empty").length,
    unchecked: network.checks.filter((check) => check.state === "unchecked").length,
    lastRetrieval: network.lastRefresh,
    priorityIncomplete,
  };
}

export function snapshotsFrom(observations: Observation[], checks: Check[]): RouteSnapshotFile {
  const pairs: Record<string, PairSnapshot> = {};
  const ensure = (origin: string, destination: string) => {
    const key = pairKey(origin, destination);
    pairs[key] ??= { flights: [], emptyDates: [], blockedDates: [] };
    return pairs[key];
  };
  for (const flight of observations) {
    const snapshot = ensure(flight.origin, flight.destination);
    snapshot.flights.push(`${flight.date}|${flight.flightNumber}|${flight.departureLocal}`);
  }
  for (const check of checks) {
    const snapshot = ensure(check.origin, check.destination);
    if (check.state === "checked_empty") snapshot.emptyDates.push(check.date);
    if (check.state === "blocked") snapshot.blockedDates.push(check.date);
  }
  for (const snapshot of Object.values(pairs)) {
    snapshot.flights.sort();
    snapshot.emptyDates.sort(compareIso);
    snapshot.blockedDates.sort(compareIso);
  }
  return { pairs };
}

export function diffSnapshots(previous: RouteSnapshotFile | null, next: RouteSnapshotFile, today: string): RouteChange[] {
  if (!previous) return [];
  const events: RouteChange[] = [];
  const keys = new Set([...Object.keys(previous.pairs), ...Object.keys(next.pairs)]);
  for (const key of [...keys].sort()) {
    const before = previous.pairs[key] ?? { flights: [], emptyDates: [], blockedDates: [] };
    const after = next.pairs[key] ?? { flights: [], emptyDates: [], blockedDates: [] };
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const [origin, destination] = key.split("|");
    if (!origin || !destination) continue;
    const beforeDates = flightDates(before.flights);
    const afterDates = flightDates(after.flights);
    const beforeLast = beforeDates.at(-1) ?? null;
    const afterLast = afterDates.at(-1) ?? null;
    const addedEmpty = after.emptyDates.filter((date) => !before.emptyDates.includes(date));
    const addedBlocked = after.blockedDates.filter((date) => !before.blockedDates.includes(date));
    if (before.flights.length === 0 && after.flights.length > 0) {
      events.push(event("new_observation", origin, destination, today, `Timed nonstop observed on ${afterDates.join(", ")}.`));
    } else if (beforeLast && afterDates.some((date) => date > beforeLast) && before.emptyDates.some((date) => date > beforeLast)) {
      events.push(event("service_reappeared", origin, destination, today, `A timed nonstop is observed again after ${beforeLast}.`));
    }
    if (before.flights.length > 0 && afterLast && beforeLast && afterLast > beforeLast) {
      events.push(event("schedule_extended", origin, destination, today, `Latest observed date moved from ${beforeLast} to ${afterLast}.`));
    }
    if (before.flights.length > 0 && after.flights.length > before.flights.length) {
      events.push(event("more_flights", origin, destination, today, `Departure rows increased from ${before.flights.length} to ${after.flights.length}.`));
    }
    if (before.flights.length > 0 && after.flights.length < before.flights.length) {
      events.push(event("fewer_flights", origin, destination, today, `Departure rows decreased from ${before.flights.length} to ${after.flights.length}.`));
    }
    const trailingEmpty = addedEmpty.filter((date) => !afterLast || date > afterLast);
    if (trailingEmpty.length && afterDates.length) {
      events.push(event("possible_gap", origin, destination, today, `Checked empty on ${trailingEmpty.join(", ")} after the latest observed flight.`));
    }
    if (addedBlocked.length) {
      events.push(event("data_blocked", origin, destination, today, `Blocked on ${addedBlocked.join(", ")}. Those dates stay unknown.`));
    }
  }
  return events;
}

export function mergeChanges(existing: RouteChange[], incoming: RouteChange[], today: string): RouteChange[] {
  const cutoff = addDays(today, -CHANGE_WINDOW_DAYS) ?? today;
  const byId = new Map<string, RouteChange>();
  for (const item of [...existing, ...incoming]) {
    if (item.recordedOn < cutoff) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => compareIso(right.recordedOn, left.recordedOn) || left.id.localeCompare(right.id)).slice(0, CHANGE_CAP);
}

export function emptyChangeFile(): RouteChangeFile {
  return { windowDays: CHANGE_WINDOW_DAYS, events: [] };
}

function event(type: RouteChangeType, origin: string, destination: string, today: string, detail: string): RouteChange {
  return {
    id: `${type}|${origin}|${destination}|${detail}`,
    type,
    origin,
    destination,
    recordedOn: today,
    detail,
  };
}

function flightDates(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => token.split("|")[0] ?? ""))].filter(Boolean).sort(compareIso);
}

function pairUniverse(schedule: ScheduleInput, observations: Observation[], checks: Check[]): Set<string> {
  const pairs = new Set<string>();
  for (const flight of observations) pairs.add(pairKey(flight.origin, flight.destination));
  for (const check of checks) {
    if (check.state === "unchecked") continue;
    pairs.add(pairKey(check.origin, check.destination));
  }
  for (const [origin, destination] of PRIORITY_CORRIDORS) pairs.add(pairKey(origin, destination));
  for (const route of schedule.routes ?? []) {
    if (route.provenance === "scheduled") pairs.add(pairKey(route.origin, route.destination));
  }
  return pairs;
}

function parseCheckKey(key: string): { origin: string; destination: string; date: string } | null {
  const [origin, destination, date] = key.split("|");
  if (!origin || !destination || !date) return null;
  return { origin, destination, date };
}

function compareObservations(left: Observation, right: Observation): number {
  return (
    compareIso(left.date, right.date) ||
    left.origin.localeCompare(right.origin) ||
    left.destination.localeCompare(right.destination) ||
    left.departureLocal.localeCompare(right.departureLocal) ||
    left.flightNumber.localeCompare(right.flightNumber)
  );
}

function validStamp(value: string): boolean {
  return UTC_STAMP.test(value) && Number.isFinite(Date.parse(value));
}
