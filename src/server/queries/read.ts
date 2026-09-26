import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { greatCircleArc } from "@/lib/graph/arcs";
import { searchItineraries, type FlightSegment } from "@/lib/graph/search";
import { untimedPaths } from "@/lib/graph/untimed";
import { timingCopy } from "@/lib/time/copy";
import { todayFromIso } from "@/lib/utils";
import { getEnv, DEFAULT_TILE_STYLE } from "@/lib/env";
import { getDb } from "@/server/db/client";
import {
  airports,
  flightInstances,
  programRules,
  routeAnnouncements,
  routeChanges,
  routeMetrics,
  routeObservations,
  routes,
  savedRoutes,
  sources,
  syncRuns,
  userPreferences,
} from "@/server/db/schema";
import { defaultPreferences, PRIORITY_AIRPORTS } from "@/server/preferences/defaults";
import type { RouteProjection, UserPreferences } from "@/types/domain";

export type MapRoute = {
  origin: string;
  destination: string;
  status: string;
  confidence: string;
  frequency: number | null;
  announcedFrequency: number | null;
  endConfirmed: boolean;
  originRegion: string;
  destinationRegion: string;
  international: boolean;
  coordinates: [number, number][];
};

export type MapAirport = {
  iata: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
  region: string;
  country: string;
};

function emptyPrefs(): UserPreferences {
  return defaultPreferences;
}

export async function readPreferences(): Promise<UserPreferences> {
  const database = getDb();
  if (!database) return emptyPrefs();
  const [row] = await database.select().from(userPreferences).where(eq(userPreferences.id, "default")).limit(1);
  return row?.payload ?? emptyPrefs();
}

async function airportMap(codes: string[]) {
  const database = getDb();
  if (!database || codes.length === 0) return new Map<string, MapAirport>();
  const rows = await database.select().from(airports).where(inArray(airports.iata, codes));
  return new Map(
    rows
      .filter((row) => row.latitude != null && row.longitude != null)
      .map((row) => [
        row.iata,
        {
          iata: row.iata,
          name: row.name,
          city: row.city,
          latitude: row.latitude as number,
          longitude: row.longitude as number,
          timezone: row.timezone,
          region: row.region,
          country: row.country,
        },
      ]),
  );
}

export async function readNetwork() {
  const database = getDb();
  if (!database) {
    return { dbError: "DATABASE_URL is not set. Start Postgres and run npm run db:setup.", routes: [] as MapRoute[], airports: [] as MapAirport[] };
  }
  const routeRows = await database.select().from(routes);
  const codes = [...new Set(routeRows.flatMap((route) => [route.originIata, route.destinationIata])), ...PRIORITY_AIRPORTS];
  const points = await airportMap(codes);
  const mapped: MapRoute[] = [];
  for (const route of routeRows) {
    const origin = points.get(route.originIata);
    const destination = points.get(route.destinationIata);
    if (!origin || !destination) continue;
    mapped.push({
      origin: route.originIata,
      destination: route.destinationIata,
      status: route.status,
      confidence: route.confidence,
      frequency: route.currentFrequencyPerWeek,
      announcedFrequency: route.announcedFrequencyPerWeek,
      endConfirmed: route.endConfirmed,
      originRegion: origin.region,
      destinationRegion: destination.region,
      international: origin.country !== "US" || destination.country !== "US",
      coordinates: greatCircleArc([origin.longitude, origin.latitude], [destination.longitude, destination.latitude]),
    });
  }
  const used = new Set(mapped.flatMap((route) => [route.origin, route.destination]));
  for (const code of PRIORITY_AIRPORTS) used.add(code);
  return {
    dbError: null,
    routes: mapped,
    airports: [...used].map((code) => points.get(code)).filter((airport): airport is MapAirport => Boolean(airport)),
  };
}

export async function readFreshness() {
  const database = getDb();
  if (!database) return null;
  const runs = await database.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(12);
  const latest = runs[0];
  return {
    latestJob: latest?.job ?? null,
    latestStatus: latest?.status ?? null,
    latestAt: latest?.finishedAt?.toISOString() ?? latest?.startedAt.toISOString() ?? null,
    runs: runs.map((run) => ({
      job: run.job,
      sourceId: run.sourceId,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      records: run.recordsObserved,
      error: run.error,
      detail: run.detail,
    })),
  };
}

export async function readDashboard() {
  const database = getDb();
  const preferences = await readPreferences();
  const today = new Date().toISOString().slice(0, 10);
  if (!database) {
    return { preferences, today, routes: [] as RouteProjection[], changes: [], popular: [], watched: [], announcements: 0 };
  }
  const routeRows = await database.select().from(routes);
  const projections = routeRows.map((row) => row.projection);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const changes = await database.select().from(routeChanges).where(gte(routeChanges.detectedAt, since)).orderBy(desc(routeChanges.detectedAt)).limit(40);
  const popular = await database.select().from(routeMetrics).where(eq(routeMetrics.metricKind, "popularity")).orderBy(desc(routeMetrics.value)).limit(8);
  const watched = await database.select().from(savedRoutes).where(eq(savedRoutes.watched, true));
  const announcementCount = await database.select({ count: sql<number>`count(*)::int` }).from(routeAnnouncements);
  return {
    preferences,
    today,
    routes: projections,
    changes: changes.map((change) => ({
      type: change.changeType,
      summary: change.summary,
      detectedAt: change.detectedAt.toISOString(),
      origin: change.originIata,
      destination: change.destinationIata,
      confidence: change.confidence,
    })),
    popular: popular.map((metric) => ({
      origin: metric.originIata,
      destination: metric.destinationIata,
      value: metric.value,
      periodLabel: metric.periodLabel,
      domesticComparable: metric.domesticComparable,
    })),
    watched,
    announcements: announcementCount[0]?.count ?? 0,
  };
}

export function moduleOptions(
  projections: RouteProjection[],
  origins: string[],
  destinations: string[],
  maxStops: number,
) {
  return untimedPaths(
    projections
      .filter((route) => route.status !== "UNKNOWN" && route.status !== "ENDED")
      .map((route) => ({
      origin: route.origin,
      destination: route.destination,
      status: route.status,
      frequency: route.currentFrequencyPerWeek,
    })),
    origins,
    destinations,
    maxStops,
  );
}

export async function readRoute(origin: string, destination: string) {
  const database = getDb();
  if (!database) return null;
  const [route] = await database
    .select()
    .from(routes)
    .where(and(eq(routes.originIata, origin.toUpperCase()), eq(routes.destinationIata, destination.toUpperCase())))
    .limit(1);
  const observations = await database
    .select()
    .from(routeObservations)
    .where(and(eq(routeObservations.originIata, origin.toUpperCase()), eq(routeObservations.destinationIata, destination.toUpperCase())))
    .orderBy(desc(routeObservations.lastRetrievedAt))
    .limit(50);
  const changes = await database
    .select()
    .from(routeChanges)
    .where(and(eq(routeChanges.originIata, origin.toUpperCase()), eq(routeChanges.destinationIata, destination.toUpperCase())))
    .orderBy(desc(routeChanges.detectedAt))
    .limit(50);
  const announcements = await database
    .select()
    .from(routeAnnouncements)
    .where(and(eq(routeAnnouncements.originIata, origin.toUpperCase()), eq(routeAnnouncements.destinationIata, destination.toUpperCase())))
    .orderBy(desc(routeAnnouncements.retrievedAt))
    .limit(20);
  const [watch] = await database
    .select()
    .from(savedRoutes)
    .where(and(eq(savedRoutes.originIata, origin.toUpperCase()), eq(savedRoutes.destinationIata, destination.toUpperCase())))
    .limit(1);
  return {
    projection: route?.projection ?? null,
    timing: route ? timingCopy(route.projection, todayFromIso(new Date().toISOString())) : null,
    observations: observations.map((row) => ({
      sourceId: row.sourceId,
      kind: row.observationKind,
      url: row.url,
      retrievedAt: row.retrievedAt.toISOString(),
      lastRetrievedAt: row.lastRetrievedAt.toISOString(),
      payload: row.payload,
    })),
    changes: changes.map((change) => ({
      type: change.changeType,
      summary: change.summary,
      detectedAt: change.detectedAt.toISOString(),
      confidence: change.confidence,
    })),
    announcements: announcements.map((item) => ({
      title: item.title,
      url: item.url,
      summary: item.summary,
      retrievedAt: item.retrievedAt.toISOString(),
      kind: item.kind,
    })),
    watch,
  };
}

export async function readAirport(iata: string) {
  const database = getDb();
  if (!database) return null;
  const [airport] = await database.select().from(airports).where(eq(airports.iata, iata.toUpperCase())).limit(1);
  if (!airport) return null;
  const outbound = await database.select().from(routes).where(eq(routes.originIata, airport.iata));
  return { airport, outbound: outbound.map((route) => route.projection) };
}

export async function readChanges(windowDays: number | null, scope: "all" | "mine" | "saved") {
  const database = getDb();
  if (!database) return [];
  const preferences = await readPreferences();
  const watched = await database.select().from(savedRoutes);
  const rows = await database.select().from(routeChanges).orderBy(desc(routeChanges.detectedAt)).limit(300);
  const cutoff = windowDays == null ? null : Date.now() - windowDays * 86_400_000;
  return rows.filter((row) => {
    if (cutoff != null && row.detectedAt.getTime() < cutoff) return false;
    if (scope === "mine") {
      const interest = new Set(preferences.heavyInterest);
      return interest.has(row.originIata) || interest.has(row.destinationIata);
    }
    if (scope === "saved") {
      return watched.some((route) => route.originIata === row.originIata && route.destinationIata === row.destinationIata);
    }
    return true;
  });
}

export async function readFrequencyRankings() {
  const database = getDb();
  if (!database) return [];
  const rows = await database.select().from(routes);
  return rows
    .filter((route) => route.currentFrequencyPerWeek != null)
    .map((route) => route.projection)
    .sort((a, b) => (b.currentFrequencyPerWeek ?? 0) - (a.currentFrequencyPerWeek ?? 0));
}

export async function readPopularity() {
  const database = getDb();
  if (!database) return { rows: [], domesticNote: "Database is not configured." };
  const rows = await database.select().from(routeMetrics).where(eq(routeMetrics.metricKind, "popularity"));
  const latest = rows.reduce<string | null>((best, row) => (!best || row.periodStart > best ? row.periodStart : best), null);
  const current = rows.filter((row) => row.periodStart === latest).sort((a, b) => b.value - a.value);
  return {
    rows: current,
    domesticNote: current.some((row) => row.domesticComparable)
      ? null
      : "Domestic T-100 passenger totals are not loaded. International totals below are historical BTS segment passengers, not current demand. Routes without passenger data are omitted instead of ranked as zero.",
  };
}

export async function readSystem() {
  const database = getDb();
  if (!database) return { sources: [], runs: [], intervals: getEnv() };
  const sourceRows = await database.select().from(sources);
  const runs = await database.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(80);
  return { sources: sourceRows, runs, intervals: getEnv() };
}

export async function readPrograms() {
  const database = getDb();
  if (!database) return [];
  const rows = await database.select().from(programRules).orderBy(desc(programRules.retrievedAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.program}:${row.ruleKey}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

export async function searchAirports(query: string) {
  const database = getDb();
  if (!database) return [];
  const text = query.trim();
  if (text.length < 2) return [];
  const upper = text.toUpperCase();
  const rows = await database
    .select()
    .from(airports)
    .where(
      sql`${airports.iata} = ${upper} OR ${airports.city} ILIKE ${"%" + text + "%"} OR ${airports.name} ILIKE ${"%" + text + "%"}`,
    )
    .limit(12);
  return rows;
}

export async function planItineraries(input: {
  origins: string[];
  destinations: string[];
  date: string;
  preferences: UserPreferences;
  unusual?: boolean;
}) {
  const database = getDb();
  if (!database) return { itineraries: [], notice: "Database is not configured." };
  const horizonDays = input.preferences.allowMultiDay ? 3 : input.preferences.allowIntentionalStopover ? 2 : 1;
  const end = new Date(Date.parse(`${input.date}T00:00:00.000Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10);
  const rows = await database
    .select({
      flight: flightInstances,
      originTz: airports.timezone,
    })
    .from(flightInstances)
    .innerJoin(airports, eq(airports.iata, flightInstances.originIata))
    .where(and(gte(flightInstances.operatingDate, input.date), sql`${flightInstances.operatingDate} <= ${end}`));
  const destinationZones = await airportMap(rows.map((row) => row.flight.destinationIata));
  const flights: FlightSegment[] = [];
  for (const row of rows) {
    const destination = destinationZones.get(row.flight.destinationIata);
    if (!row.flight.departureLocal || !row.flight.arrivalLocal || !row.originTz || !destination?.timezone) continue;
    flights.push({
      id: `${row.flight.originIata}-${row.flight.destinationIata}-${row.flight.departureLocal}`,
      origin: row.flight.originIata,
      destination: row.flight.destinationIata,
      departureLocal: row.flight.departureLocal,
      arrivalLocal: row.flight.arrivalLocal,
      originTimezone: row.originTz,
      destinationTimezone: destination.timezone,
      flightNumber: row.flight.flightNumber ?? undefined,
    });
  }
  if (flights.length === 0) {
    return {
      itineraries: [],
      notice:
        "No scheduled flight times are loaded. The timetable source has not produced observations, so connections cannot be timed. Announcement paths are shown separately and are not treated as a schedule.",
    };
  }
  return {
    itineraries: searchItineraries(flights, {
      origins: input.origins,
      destinations: input.destinations,
      date: input.date,
      maxStops: input.preferences.maxStops,
      minConnectionMinutes: input.preferences.minConnectionMinutes,
      allowLongConnection: input.preferences.allowLongConnection,
      allowIntentionalStopover: input.preferences.allowIntentionalStopover,
      allowMultiDay: input.preferences.allowMultiDay,
      excludeRedEyes: input.preferences.excludeRedEyes,
      maxJourneyHours: input.preferences.maxJourneyHours,
      preferVegasStopover: input.preferences.preferVegasStopover,
      unusual: input.unusual,
      preferredOrigins: input.preferences.homePriority,
      preferredDestinations: ["LAX", "BUR", "LGA", "JFK", "MCO"],
    }),
    notice: null,
  };
}

export function tileStyle() {
  return getEnv().TILE_STYLE_URL || DEFAULT_TILE_STYLE;
}
