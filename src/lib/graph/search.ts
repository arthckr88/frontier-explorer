import {
  categorizeConnection,
  categoryAllowed,
  connectionMinutes,
  elapsedMinutes,
  isOvernightGround,
} from "@/lib/time/connection";
import { isRedEyeSegment } from "@/lib/time/redeye";

export type FlightSegment = {
  id: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  originTimezone: string;
  destinationTimezone: string;
  flightNumber?: string;
  frequencyPerWeek?: number;
};

export type SearchQuery = {
  origins: string[];
  destinations: string[];
  date: string;
  maxStops: number;
  minConnectionMinutes: number;
  allowLongConnection: boolean;
  allowIntentionalStopover: boolean;
  allowMultiDay: boolean;
  excludeRedEyes: boolean;
  maxJourneyHours: number;
  preferVegasStopover: boolean;
  unusual?: boolean;
  preferredOrigins?: string[];
  preferredDestinations?: string[];
};

export type ScoreFactor = {
  id: string;
  label: string;
  points: number;
  detail: string;
};

export type ItineraryConnection = {
  airport: string;
  minutes: number;
  category: string;
  overnightGround: boolean;
  vegasOvernight: boolean;
  label: string;
};

export type Itinerary = {
  id: string;
  segments: FlightSegment[];
  stops: number;
  connections: ItineraryConnection[];
  elapsedMinutes: number;
  hasRedEye: boolean;
  score: number;
  factors: ScoreFactor[];
  unusual: boolean;
};

function localDate(localIso: string) {
  return localIso.slice(0, 10);
}

function departureConvenience(localIso: string): { points: number; detail: string } {
  const hour = Number(localIso.slice(11, 13));
  if (hour >= 9 && hour < 18) return { points: 30, detail: "Departure is during the daytime." };
  if ((hour >= 7 && hour < 9) || (hour >= 18 && hour < 21)) {
    return { points: 18, detail: "Departure is early morning or evening, still outside the red-eye window." };
  }
  if ((hour >= 5 && hour < 7) || (hour >= 21 && hour < 22)) {
    return { points: 6, detail: "Departure is close to the overnight window." };
  }
  return { points: 0, detail: "Departure is overnight." };
}

function connectionPoints(connection: ItineraryConnection, preferVegas: boolean): ScoreFactor {
  if (connection.vegasOvernight && preferVegas) {
    return {
      id: "vegas-overnight",
      label: "Overnight in Las Vegas",
      points: 28,
      detail: "An intentional Las Vegas overnight is treated as acceptable, not as a bad connection.",
    };
  }
  if (connection.category === "normal" && connection.minutes >= 90) {
    return {
      id: "connection",
      label: "Connection",
      points: 22,
      detail: `${Math.round(connection.minutes)} minutes on the ground is a normal connection.`,
    };
  }
  if (connection.category === "normal") {
    return {
      id: "connection",
      label: "Connection",
      points: 8,
      detail: `${Math.round(connection.minutes)} minutes is a short connection.`,
    };
  }
  if (connection.category === "long") {
    return {
      id: "connection",
      label: "Connection",
      points: 12,
      detail: `${Math.round(connection.minutes)} minutes is a long connection.`,
    };
  }
  if (connection.overnightGround) {
    return {
      id: "connection",
      label: "Overnight stopover",
      points: 10,
      detail: "Overnight ground time is allowed and is not labeled as a layover penalty.",
    };
  }
  return {
    id: "connection",
    label: "Connection",
    points: 4,
    detail: `${Math.round(connection.minutes)} minutes between flights.`,
  };
}

export function scoreItinerary(
  itinerary: Omit<Itinerary, "score" | "factors" | "unusual">,
  query: SearchQuery,
): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  const first = itinerary.segments[0];
  const last = itinerary.segments[itinerary.segments.length - 1];
  if (itinerary.hasRedEye) {
    factors.push({
      id: "red-eye",
      label: "Red-eye",
      points: -100,
      detail: "A segment departs overnight or is airborne across the night.",
    });
  } else {
    factors.push({
      id: "red-eye",
      label: "No red-eye",
      points: 40,
      detail: "No segment is an overnight flight.",
    });
  }
  if (first && query.preferredOrigins?.includes(first.origin)) {
    const oak = first.origin === "OAK";
    factors.push({
      id: "origin",
      label: oak ? "OAK origin" : `${first.origin} origin`,
      points: oak ? 36 : 16,
      detail: oak ? "OAK is preferred over the other home airport." : "Origin is a preferred airport.",
    });
  }
  if (last && query.preferredDestinations?.includes(last.destination)) {
    factors.push({
      id: "destination",
      label: `${last.destination} destination`,
      points: 24,
      detail: "Destination is one of the preferred airports for this search.",
    });
  }
  factors.push({
    id: "stops",
    label: itinerary.stops === 0 ? "Nonstop" : `${itinerary.stops} stop${itinerary.stops === 1 ? "" : "s"}`,
    points: Math.max(0, 30 - itinerary.stops * 12),
    detail: "Fewer stops rank higher.",
  });
  if (first) {
    const convenience = departureConvenience(first.departureLocal);
    factors.push({
      id: "departure",
      label: "Departure time",
      points: convenience.points,
      detail: convenience.detail,
    });
  }
  if (itinerary.connections.length === 0) {
    factors.push({
      id: "connection",
      label: "Nonstop",
      points: 22,
      detail: "There is no connection.",
    });
  } else {
    for (const connection of itinerary.connections) {
      factors.push(connectionPoints(connection, query.preferVegasStopover));
    }
  }
  const frequency = Math.max(...itinerary.segments.map((segment) => segment.frequencyPerWeek ?? 0));
  if (frequency > 0) {
    factors.push({
      id: "frequency",
      label: "Frequency",
      points: Math.min(15, frequency * 2),
      detail: `${frequency} scheduled departures/week were observed on a segment.`,
    });
  }
  const score = factors.reduce((sum, factor) => sum + factor.points, 0);
  return { score, factors };
}

function buildItinerary(segments: FlightSegment[], query: SearchQuery): Itinerary | null {
  const connections: ItineraryConnection[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const current = segments[index];
    const next = segments[index + 1];
    if (!current || !next || current.destination !== next.origin) return null;
    const minutes = connectionMinutes(
      current.arrivalLocal,
      current.destinationTimezone,
      next.departureLocal,
      next.originTimezone,
    );
    const category = categorizeConnection(minutes, query.minConnectionMinutes);
    if (
      !categoryAllowed(category, {
        allowLongConnection: query.allowLongConnection,
        allowIntentionalStopover: query.allowIntentionalStopover,
        allowMultiDay: query.allowMultiDay,
      })
    ) {
      return null;
    }
    const overnightGround = isOvernightGround(
      current.arrivalLocal,
      current.destinationTimezone,
      next.departureLocal,
      next.originTimezone,
      minutes,
    );
    const vegasOvernight = current.destination === "LAS" && overnightGround;
    connections.push({
      airport: current.destination,
      minutes,
      category,
      overnightGround,
      vegasOvernight,
      label: vegasOvernight
        ? "Overnight in Las Vegas"
        : overnightGround
          ? `Overnight ground stop in ${current.destination}`
          : `${Math.round(minutes)} min in ${current.destination}`,
    });
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return null;
  const total = elapsedMinutes(
    first.departureLocal,
    first.originTimezone,
    last.arrivalLocal,
    last.destinationTimezone,
  );
  if (!Number.isFinite(total) || total < 0 || total > query.maxJourneyHours * 60) return null;
  const hasRedEye = segments.some((segment) => isRedEyeSegment(segment));
  if (query.excludeRedEyes && hasRedEye) return null;

  const draft = {
    id: segments.map((segment) => segment.id).join(">"),
    segments,
    stops: segments.length - 1,
    connections,
    elapsedMinutes: total,
    hasRedEye,
  };
  const scored = scoreItinerary(draft, query);
  return { ...draft, ...scored, unusual: false };
}

export function searchItineraries(flights: FlightSegment[], query: SearchQuery): Itinerary[] {
  const byOrigin = new Map<string, FlightSegment[]>();
  for (const flight of flights) {
    const list = byOrigin.get(flight.origin) ?? [];
    list.push(flight);
    byOrigin.set(flight.origin, list);
  }
  const destinations = new Set(query.destinations);
  const results: Itinerary[] = [];
  const maxLegs = query.maxStops + 1;

  function walk(path: FlightSegment[]) {
    const built = buildItinerary(path, query);
    const last = path[path.length - 1];
    if (built && last && destinations.has(last.destination)) results.push(built);
    if (path.length >= maxLegs || !last) return;
    const visited = new Set(path.flatMap((segment) => [segment.origin, segment.destination]));
    for (const next of byOrigin.get(last.destination) ?? []) {
      if (path.some((segment) => segment.id === next.id)) continue;
      if (visited.has(next.destination) && !destinations.has(next.destination)) continue;
      const minutes = connectionMinutes(
        last.arrivalLocal,
        last.destinationTimezone,
        next.departureLocal,
        next.originTimezone,
      );
      const category = categorizeConnection(minutes, query.minConnectionMinutes);
      if (
        !categoryAllowed(category, {
          allowLongConnection: query.allowLongConnection,
          allowIntentionalStopover: query.allowIntentionalStopover,
          allowMultiDay: query.allowMultiDay,
        })
      ) {
        continue;
      }
      if (query.excludeRedEyes && isRedEyeSegment(next)) continue;
      walk([...path, next]);
    }
  }

  for (const origin of query.origins) {
    for (const flight of byOrigin.get(origin) ?? []) {
      if (localDate(flight.departureLocal) !== query.date) continue;
      if (query.excludeRedEyes && isRedEyeSegment(flight)) continue;
      walk([flight]);
    }
  }

  const viaCounts = new Map<string, number>();
  for (const itinerary of results) {
    for (const connection of itinerary.connections) {
      viaCounts.set(connection.airport, (viaCounts.get(connection.airport) ?? 0) + 1);
    }
  }
  const counts = [...viaCounts.values()].sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 1;

  const ranked = results.map((itinerary) => {
    const via = itinerary.connections[0]?.airport;
    const rare = Boolean(via && (viaCounts.get(via) ?? 0) <= median);
    return { ...itinerary, unusual: rare };
  });

  ranked.sort((a, b) => compareItineraries(a, b, query, viaCounts, median));
  return ranked;
}

function compareItineraries(
  a: Itinerary,
  b: Itinerary,
  query: SearchQuery,
  viaCounts: Map<string, number>,
  median: number,
): number {
  if (query.unusual) {
    const rarity = (itinerary: Itinerary) => {
      const via = itinerary.connections[0]?.airport;
      if (!via) return 1;
      return (viaCounts.get(via) ?? 0) <= median ? 0 : 2;
    };
    const rareDelta = rarity(a) - rarity(b);
    if (rareDelta !== 0) return rareDelta;
  }
  const redEye = Number(a.hasRedEye) - Number(b.hasRedEye);
  if (redEye !== 0) return redEye;
  const originScore = (itinerary: Itinerary) => {
    const origin = itinerary.segments[0]?.origin;
    if (origin === "OAK") return 2;
    if (query.preferredOrigins?.includes(origin ?? "")) return 1;
    return 0;
  };
  const originDelta = originScore(b) - originScore(a);
  if (originDelta !== 0) return originDelta;
  const destScore = (itinerary: Itinerary) => {
    const destination = itinerary.segments.at(-1)?.destination;
    return query.preferredDestinations?.includes(destination ?? "") ? 1 : 0;
  };
  const destDelta = destScore(b) - destScore(a);
  if (destDelta !== 0) return destDelta;
  if (a.stops !== b.stops) return a.stops - b.stops;
  if (a.score !== b.score) return b.score - a.score;
  return a.elapsedMinutes - b.elapsedMinutes;
}
