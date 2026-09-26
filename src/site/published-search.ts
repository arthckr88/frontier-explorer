export type PublishedFlight = {
  origin: string;
  destination: string;
  flightNumber: string;
  date: string;
  departureLocal: string;
  arrivalLocal: string;
  departureUtc: string;
  arrivalUtc: string;
};

export type RouteProvenance = "listed" | "scheduled";

export type PublishedRoute = {
  origin: string;
  destination: string;
  provenance: RouteProvenance;
};

export type PublishedSchedule = {
  flights: PublishedFlight[];
  routes?: PublishedRoute[];
  checked: string[];
  blocked: string[];
};

export type PublishedConnection = {
  airport: string;
  minutes: number;
  label: string;
  vegasOvernight: boolean;
};

export type PublishedItinerary = {
  stops: number;
  elapsedMinutes: number;
  vegasOvernight: boolean;
  connectionLabel: string | null;
  connections: PublishedConnection[];
  hasRedEye: boolean;
  segments: PublishedFlight[];
};

export type PublishedSearchResult = {
  itineraries: PublishedItinerary[];
  hiddenRedEyes: number;
};

const MIN_CONNECTION = 60;
const NORMAL_MAX = 4 * 60;
const LONG_MAX = 8 * 60;
const STOPOVER_MAX = 24 * 60;

export function searchPublished(
  flights: PublishedFlight[],
  query: {
    from: string;
    to: string | string[];
    date: string;
    stops?: { nonstop?: boolean; one?: boolean; two?: boolean };
    excludeRedEyes?: boolean;
  },
): PublishedSearchResult {
  const from = query.from.trim().toUpperCase();
  const destinations = new Set(
    (Array.isArray(query.to) ? query.to : [query.to]).map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{3}$/.test(code)),
  );
  destinations.delete(from);
  const date = query.date;
  const allowNonstop = query.stops?.nonstop !== false;
  const allowOne = query.stops?.one !== false;
  const allowTwo = query.stops?.two !== false;
  const excludeRedEyes = query.excludeRedEyes !== false;
  const byOrigin = new Map<string, PublishedFlight[]>();
  for (const flight of flights) {
    const bucket = byOrigin.get(flight.origin);
    if (bucket) bucket.push(flight);
    else byOrigin.set(flight.origin, [flight]);
  }

  const results: PublishedItinerary[] = [];
  const seen = new Set<string>();
  let hiddenRedEyes = 0;

  const add = (segments: PublishedFlight[], connections: PublishedConnection[]) => {
    const hasRedEye = segments.some(isRedEye);
    if (hasRedEye && excludeRedEyes) {
      hiddenRedEyes += 1;
      return;
    }
    const key = segments.map((segment) => `${segment.flightNumber}|${segment.departureUtc}|${segment.origin}|${segment.destination}`).join(">");
    if (seen.has(key)) return;
    seen.add(key);
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) return;
    const vegasOvernight = connections.some((connection) => connection.vegasOvernight);
    results.push({
      stops: segments.length - 1,
      elapsedMinutes: minutesBetween(first.departureUtc, last.arrivalUtc),
      vegasOvernight,
      connectionLabel: vegasOvernight ? "Overnight in Las Vegas" : connections.map((connection) => connection.label).join(" · ") || null,
      connections,
      hasRedEye,
      segments,
    });
  };

  if (allowNonstop) {
    for (const flight of byOrigin.get(from) ?? []) {
      if (flight.date === date && destinations.has(flight.destination)) add([flight], []);
    }
  }

  if (allowOne || allowTwo) {
    for (const first of departing(byOrigin, from, date)) {
      if (destinations.has(first.destination)) continue;
      for (const second of byOrigin.get(first.destination) ?? []) {
        if (second.origin === from || second.destination === from || second.destination === first.destination) continue;
        const firstConnection = connect(first, second);
        if (!firstConnection) continue;
        if (allowOne && destinations.has(second.destination)) add([first, second], [firstConnection]);
        if (!allowTwo || destinations.has(second.destination)) continue;
        for (const third of byOrigin.get(second.destination) ?? []) {
          if (!destinations.has(third.destination)) continue;
          if (third.destination === from || third.destination === first.destination || third.destination === second.destination) continue;
          if (third.origin === from || third.origin === first.origin) continue;
          const secondConnection = connect(second, third);
          if (!secondConnection) continue;
          add([first, second, third], [firstConnection, secondConnection]);
        }
      }
    }
  }

  results.sort((left, right) => {
    if (left.stops !== right.stops) return left.stops - right.stops;
    const depart = left.segments[0]?.departureUtc.localeCompare(right.segments[0]?.departureUtc ?? "") ?? 0;
    if (depart !== 0) return depart;
    return left.elapsedMinutes - right.elapsedMinutes;
  });
  return { itineraries: results, hiddenRedEyes };
}

function departing(byOrigin: Map<string, PublishedFlight[]>, origin: string, date: string) {
  return (byOrigin.get(origin) ?? []).filter((flight) => flight.date === date);
}

function connect(first: PublishedFlight, second: PublishedFlight): PublishedConnection | null {
  const gap = minutesBetween(first.arrivalUtc, second.departureUtc);
  if (!Number.isFinite(gap) || gap < MIN_CONNECTION || gap > STOPOVER_MAX) return null;
  const overnightGround = gap >= LONG_MAX && second.departureLocal.slice(0, 10) > first.arrivalLocal.slice(0, 10);
  const vegasOvernight = first.destination === "LAS" && overnightGround;
  if (gap <= NORMAL_MAX || gap <= LONG_MAX) {
    return { airport: first.destination, minutes: Math.round(gap), label: `${Math.round(gap)} min in ${first.destination}`, vegasOvernight: false };
  }
  if (!overnightGround) return null;
  return {
    airport: first.destination,
    minutes: Math.round(gap),
    vegasOvernight,
    label: vegasOvernight ? "Overnight in Las Vegas" : `Overnight ground stop in ${first.destination}`,
  };
}

function isRedEye(flight: PublishedFlight): boolean {
  const departureMinutes = clockMinutes(flight.departureLocal);
  if (departureMinutes === null) return false;
  if (departureMinutes >= 22 * 60 || departureMinutes < 5 * 60) return true;
  const airborneHours = minutesBetween(flight.departureUtc, flight.arrivalUtc) / 60;
  const arrivalMinutes = clockMinutes(flight.arrivalLocal);
  const arrivesNextDay = flight.arrivalLocal.slice(0, 10) > flight.departureLocal.slice(0, 10);
  return airborneHours >= 3 && arrivesNextDay && arrivalMinutes !== null && arrivalMinutes < 8 * 60 && departureMinutes >= 17 * 60;
}

function minutesBetween(startUtc: string, endUtc: string): number {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;
  return (end - start) / 60_000;
}

function clockMinutes(local: string): number | null {
  const match = /T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
