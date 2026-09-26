import { and, eq } from "drizzle-orm";
import airportData from "../../../data/airports.json";
import { getEnv } from "@/lib/env";
import { getDb } from "@/server/db/client";
import { airports, flightInstances, routes } from "@/server/db/schema";
import { fetchPublicScheduleDay } from "@/server/ingestion/sources/public-schedule";
import type { PublicFlight } from "@/server/ingestion/parse/public-schedule";
import { legsForSearch, selectSearchHubs, type DirectedPair, type SearchLeg } from "@/server/search/hubs";

const SOURCE_ID = "frontier-public-schedule";
const HUB_LIMIT = 4;
const AIRPORT_ZONES = new Map(
  (airportData as { iata: string; timezone: string }[]).map((airport) => [airport.iata, airport.timezone]),
);

export type LiveSearchReport = {
  fetched: string[];
  cached: string[];
  blocked: { leg: string; detail: string }[];
  errors: { leg: string; detail: string }[];
  flightsFound: number;
};

export async function coverLiveSearch(input: {
  origin: string;
  destination: string;
  date: string;
  maxStops: number;
  allowVegasOvernight: boolean;
}): Promise<LiveSearchReport> {
  const report: LiveSearchReport = { fetched: [], cached: [], blocked: [], errors: [], flightsFound: 0 };
  const database = getDb();
  if (!database) {
    report.errors.push({ leg: `${input.origin}-${input.destination}`, detail: "Database is not configured." });
    return report;
  }
  const edges = await knownEdges();
  const hubs =
    input.maxStops >= 1
      ? selectSearchHubs(edges, [input.origin], [input.destination], HUB_LIMIT)
      : [];
  const legs = legsForSearch({
    origins: [input.origin],
    destinations: [input.destination],
    date: input.date,
    hubs,
    fetchOvernightFromLas: input.allowVegasOvernight,
  });
  const cap = Math.min(4, Math.max(1, getEnv().PUBLIC_SCHEDULE_CONCURRENCY || 4));
  await mapPool(legs, cap, async (leg) => {
    const label = `${leg.origin}→${leg.destination} ${leg.date}`;
    const result = await fetchPublicScheduleDay(leg.origin, leg.destination, leg.date);
    if (!result.ok) {
      const bucket = result.blocked ? report.blocked : report.errors;
      bucket.push({ leg: label, detail: result.detail });
      return;
    }
    (result.cached ? report.cached : report.fetched).push(label);
    report.flightsFound += result.flights.length;
    await materializeDay(leg, result.flights, result.cached);
  });
  return report;
}

async function knownEdges(): Promise<DirectedPair[]> {
  const database = getDb();
  if (!database) return [];
  const [routeRows, flightRows] = await Promise.all([
    database.select({ origin: routes.originIata, destination: routes.destinationIata }).from(routes),
    database
      .selectDistinct({ origin: flightInstances.originIata, destination: flightInstances.destinationIata })
      .from(flightInstances),
  ]);
  const seen = new Set<string>();
  const edges: DirectedPair[] = [];
  for (const row of [...routeRows, ...flightRows]) {
    const key = `${row.origin}|${row.destination}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ origin: row.origin, destination: row.destination });
  }
  return edges;
}

async function materializeDay(leg: SearchLeg, flights: PublicFlight[], cached: boolean) {
  const database = getDb();
  if (!database) return;
  const matching = flights.filter(
    (flight) => flight.origin === leg.origin && flight.destination === leg.destination && flight.date === leg.date,
  );
  const already = await database
    .select({ id: flightInstances.id })
    .from(flightInstances)
    .where(
      and(
        eq(flightInstances.originIata, leg.origin),
        eq(flightInstances.destinationIata, leg.destination),
        eq(flightInstances.operatingDate, leg.date),
        eq(flightInstances.sourceId, SOURCE_ID),
      ),
    )
    .limit(1);
  if (cached && matching.length === 0 && already.length === 0) return;
  if (cached && matching.length > 0 && already.length > 0) return;
  const codes = new Set<string>();
  for (const flight of matching) {
    codes.add(flight.origin);
    codes.add(flight.destination);
  }
  for (const iata of codes) {
    const timezone = AIRPORT_ZONES.get(iata) ?? null;
    await database
      .insert(airports)
      .values({ iata, name: iata, city: iata, country: "US", timezone, region: "other" })
      .onConflictDoNothing();
  }
  await database
    .delete(flightInstances)
    .where(
      and(
        eq(flightInstances.originIata, leg.origin),
        eq(flightInstances.destinationIata, leg.destination),
        eq(flightInstances.operatingDate, leg.date),
        eq(flightInstances.sourceId, SOURCE_ID),
      ),
    );
  const retrievedAt = new Date();
  for (const flight of matching) {
    if (!flight.departureLocal || !flight.arrivalLocal) continue;
    await database.insert(flightInstances).values({
      originIata: flight.origin,
      destinationIata: flight.destination,
      operatingDate: flight.date,
      departureLocal: flight.departureLocal,
      arrivalLocal: flight.arrivalLocal,
      flightNumber: flight.flightNumber,
      sourceId: SOURCE_ID,
      retrievedAt,
    });
  }
}

async function mapPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  if (items.length === 0) return;
  let index = 0;
  async function worker() {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      const item = items[current];
      if (item === undefined) return;
      await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}
