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

export type ConnectionKind = "normal" | "long" | "overnight";

export type PublishedConnection = {
  airport: string;
  minutes: number;
  label: string;
  kind: ConnectionKind;
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

export type TimeWindow = "morning" | "afternoon" | "evening";

export type ItineraryFilter = {
  maxElapsedMinutes?: number | null;
  departureWindow?: TimeWindow | "" | null;
  arrivalWindow?: TimeWindow | "" | null;
  connectingAirport?: string | null;
  maxLayoverMinutes?: number | null;
};

export type ItineraryFilterHidden = {
  duration: number;
  departure: number;
  arrival: number;
  connecting: number;
  layover: number;
};

const MIN_CONNECTION = 60;
const NORMAL_MAX = 4 * 60;
const LONG_MAX = 8 * 60;
const OVERNIGHT_MAX = 30 * 60;

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

export function filterItineraries(itineraries: PublishedItinerary[], filters: ItineraryFilter = {}) {
  const hidden: ItineraryFilterHidden = { duration: 0, departure: 0, arrival: 0, connecting: 0, layover: 0 };
  const kept: PublishedItinerary[] = [];
  const maxElapsed = positiveMinutes(filters.maxElapsedMinutes);
  const maxLayover = positiveMinutes(filters.maxLayoverMinutes);
  const hub = filters.connectingAirport?.trim().toUpperCase() ?? "";
  const depart = filters.departureWindow || "";
  const arrive = filters.arrivalWindow || "";
  for (const itinerary of itineraries) {
    if (maxElapsed !== null && itinerary.elapsedMinutes >= maxElapsed) {
      hidden.duration += 1;
      continue;
    }
    const first = itinerary.segments[0];
    const last = itinerary.segments[itinerary.segments.length - 1];
    if (depart && !inTimeWindow(first?.departureLocal ?? "", depart)) {
      hidden.departure += 1;
      continue;
    }
    if (arrive && !inTimeWindow(last?.arrivalLocal ?? "", arrive)) {
      hidden.arrival += 1;
      continue;
    }
    if (hub && !itinerary.connections.some((connection) => connection.airport === hub)) {
      hidden.connecting += 1;
      continue;
    }
    if (maxLayover !== null && itinerary.connections.some((connection) => connection.minutes > maxLayover)) {
      hidden.layover += 1;
      continue;
    }
    kept.push(itinerary);
  }
  return { itineraries: kept, hidden };
}

function departing(byOrigin: Map<string, PublishedFlight[]>, origin: string, date: string) {
  return (byOrigin.get(origin) ?? []).filter((flight) => flight.date === date);
}

function connect(first: PublishedFlight, second: PublishedFlight): PublishedConnection | null {
  const gap = minutesBetween(first.arrivalUtc, second.departureUtc);
  if (!Number.isFinite(gap) || gap < MIN_CONNECTION) return null;
  const minutes = Math.round(gap);
  const arrivalDate = first.arrivalLocal.slice(0, 10);
  const departureDate = second.departureLocal.slice(0, 10);
  const nextDay = addDays(arrivalDate, 1);
  const overnightGround = nextDay !== null && departureDate === nextDay && gap > LONG_MAX && gap <= OVERNIGHT_MAX;
  const vegasOvernight = first.destination === "LAS" && overnightGround;
  if (vegasOvernight) {
    return { airport: first.destination, minutes, kind: "overnight", vegasOvernight: true, label: "Overnight in Las Vegas" };
  }
  if (gap <= NORMAL_MAX) {
    return { airport: first.destination, minutes, kind: "normal", vegasOvernight: false, label: `${minutes} min in ${first.destination}` };
  }
  if (gap <= LONG_MAX) {
    return {
      airport: first.destination,
      minutes,
      kind: "long",
      vegasOvernight: false,
      label: `Long layover · ${minutes} min in ${first.destination}`,
    };
  }
  if (overnightGround && gap <= 24 * 60) {
    return {
      airport: first.destination,
      minutes,
      kind: "overnight",
      vegasOvernight: false,
      label: `Overnight ground stop in ${first.destination}`,
    };
  }
  return null;
}

function addDays(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function positiveMinutes(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function inTimeWindow(local: string, windowName: string) {
  const minutes = clockMinutes(local);
  if (minutes === null) return false;
  if (windowName === "morning") return minutes >= 5 * 60 && minutes < 12 * 60;
  if (windowName === "afternoon") return minutes >= 12 * 60 && minutes < 17 * 60;
  if (windowName === "evening") return minutes >= 17 * 60 && minutes < 22 * 60;
  return true;
}

function clockMinutes(local: string): number | null {
  const match = /T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
