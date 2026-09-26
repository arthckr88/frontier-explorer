import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Observation, RouteProjection } from "@/types/domain";

export const airports = pgTable("airports", {
  iata: text("iata").primaryKey(),
  icao: text("icao"),
  name: text("name").notNull(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  timezone: text("timezone"),
  region: text("region").notNull().default("other"),
  metroCode: text("metro_code"),
});

export const metroAreas = pgTable("metro_areas", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  primaryAirports: jsonb("primary_airports").$type<string[]>().notNull(),
  nearbyAirports: jsonb("nearby_airports").$type<string[]>().notNull(),
});

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: integer("tier").notNull(),
  kind: text("kind").notNull(),
  baseUrl: text("base_url"),
});

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job: text("job").notNull(),
    sourceId: text("source_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    recordsObserved: integer("records_observed").notNull().default(0),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    detail: text("detail"),
  },
  (table) => [index("sync_runs_source_idx").on(table.sourceId, table.startedAt)],
);

export const routeObservations = pgTable(
  "route_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: text("source_id").notNull(),
    url: text("url"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    lastRetrievedAt: timestamp("last_retrieved_at", { withTimezone: true }).notNull(),
    externalId: text("external_id").notNull(),
    originIata: text("origin_iata").notNull(),
    destinationIata: text("destination_iata").notNull(),
    observationKind: text("observation_kind").notNull(),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").$type<Observation>().notNull(),
  },
  (table) => [
    uniqueIndex("route_observations_hash_idx").on(
      table.sourceId,
      table.externalId,
      table.originIata,
      table.destinationIata,
      table.contentHash,
    ),
    index("route_observations_pair_idx").on(table.originIata, table.destinationIata),
  ],
);

export const routes = pgTable(
  "routes",
  {
    originIata: text("origin_iata").notNull(),
    destinationIata: text("destination_iata").notNull(),
    status: text("status").notNull(),
    confidence: text("confidence").notNull(),
    endConfirmed: boolean("end_confirmed").notNull().default(false),
    launchUnverified: boolean("launch_unverified").notNull().default(false),
    seasonal: boolean("seasonal").notNull().default(false),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    firstScheduledDeparture: text("first_scheduled_departure"),
    lastScheduledDeparture: text("last_scheduled_departure"),
    announcedStartDate: text("announced_start_date"),
    announcedEndDate: text("announced_end_date"),
    announcedFrequencyPerWeek: integer("announced_frequency_per_week"),
    currentFrequencyPerWeek: integer("current_frequency_per_week"),
    previousFrequencyPerWeek: integer("previous_frequency_per_week"),
    scheduleDays: jsonb("schedule_days").$type<number[]>().notNull(),
    scheduleHorizon: text("schedule_horizon"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    suspectedEndDate: text("suspected_end_date"),
    latestMarketedDeparture: text("latest_marketed_departure"),
    projection: jsonb("projection").$type<RouteProjection>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.originIata, table.destinationIata] }),
    index("routes_status_idx").on(table.status),
  ],
);

export const routeSnapshots = pgTable(
  "route_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originIata: text("origin_iata").notNull(),
    destinationIata: text("destination_iata").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    projection: jsonb("projection").$type<RouteProjection>().notNull(),
  },
  (table) => [index("route_snapshots_pair_idx").on(table.originIata, table.destinationIata, table.capturedAt)],
);

export const routeChanges = pgTable(
  "route_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originIata: text("origin_iata").notNull(),
    destinationIata: text("destination_iata").notNull(),
    changeType: text("change_type").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    confidence: text("confidence").notNull(),
    before: jsonb("before").$type<RouteProjection | null>(),
    after: jsonb("after").$type<RouteProjection>().notNull(),
  },
  (table) => [index("route_changes_detected_idx").on(table.detectedAt)],
);

export const flightInstances = pgTable(
  "flight_instances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originIata: text("origin_iata").notNull(),
    destinationIata: text("destination_iata").notNull(),
    operatingDate: text("operating_date").notNull(),
    departureLocal: text("departure_local"),
    arrivalLocal: text("arrival_local"),
    flightNumber: text("flight_number"),
    sourceId: text("source_id").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("flight_instances_date_idx").on(table.operatingDate, table.originIata)],
);

export const routeAnnouncements = pgTable(
  "route_announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originIata: text("origin_iata"),
    destinationIata: text("destination_iata"),
    title: text("title").notNull(),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    kind: text("kind").notNull(),
    announcedStart: text("announced_start"),
    announcedEnd: text("announced_end"),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
  },
  (table) => [index("route_announcements_pair_idx").on(table.originIata, table.destinationIata)],
);

export const routeMetrics = pgTable(
  "route_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originIata: text("origin_iata").notNull(),
    destinationIata: text("destination_iata").notNull(),
    metricKind: text("metric_kind").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    periodLabel: text("period_label").notNull(),
    value: integer("value").notNull(),
    unit: text("unit").notNull(),
    sourceId: text("source_id").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    domesticComparable: boolean("domestic_comparable").notNull().default(false),
  },
  (table) => [
    index("route_metrics_period_idx").on(table.metricKind, table.periodStart, table.originIata),
  ],
);

export const programRules = pgTable("program_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  program: text("program").notNull(),
  ruleKey: text("rule_key").notNull(),
  summary: text("summary").notNull(),
  value: jsonb("value").$type<Record<string, string | number | boolean | null>>().notNull(),
  sourceUrl: text("source_url"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  effectiveDate: text("effective_date"),
});

export const userPreferences = pgTable("user_preferences", {
  id: text("id").primaryKey(),
  payload: jsonb("payload").$type<import("@/types/domain").UserPreferences>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const savedRoutes = pgTable(
  "saved_routes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originIata: text("origin_iata").notNull(),
    destinationIata: text("destination_iata").notNull(),
    label: text("label").notNull(),
    watched: boolean("watched").notNull().default(false),
    note: text("note"),
  },
  (table) => [uniqueIndex("saved_routes_pair_idx").on(table.originIata, table.destinationIata)],
);

export const savedSearches = pgTable("saved_searches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

export const sourceCache = pgTable("source_cache", {
  sourceId: text("source_id").notNull(),
  cacheKey: text("cache_key").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  body: text("body").notNull(),
}, (table) => [primaryKey({ columns: [table.sourceId, table.cacheKey] })]);
