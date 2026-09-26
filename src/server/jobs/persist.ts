import { and, eq, inArray, isNull } from "drizzle-orm";
import { observationHash } from "@/server/ingestion/parse/newsroom";
import type { SourceRunResult } from "@/server/ingestion/types";
import { getDb } from "@/server/db/client";
import {
  airports,
  flightInstances,
  programRules,
  routeAnnouncements,
  routeChanges,
  routeMetrics,
  routeObservations,
  routeSnapshots,
  routes,
  syncRuns,
} from "@/server/db/schema";
import { reconcileNetwork } from "@/server/reconciliation/reconcile";
import { thresholdsFromEnv } from "@/server/reconciliation/thresholds";
import type { Observation, RouteProjection } from "@/types/domain";

function dbOrThrow() {
  const database = getDb();
  if (!database) throw new Error("DATABASE_URL is not set.");
  return database;
}

export async function recordSyncRun(input: {
  job: string;
  sourceId?: string;
  startedAt: Date;
  status: string;
  recordsObserved: number;
  latencyMs: number;
  error?: string;
  detail?: string;
}) {
  const database = dbOrThrow();
  await database.insert(syncRuns).values({
    job: input.job,
    sourceId: input.sourceId,
    startedAt: input.startedAt,
    finishedAt: new Date(),
    status: input.status,
    recordsObserved: input.recordsObserved,
    latencyMs: input.latencyMs,
    error: input.error,
    detail: input.detail,
  });
}

async function ensureAirport(iata: string) {
  const database = dbOrThrow();
  await database
    .insert(airports)
    .values({
      iata,
      name: iata,
      city: iata,
      country: "ZZ",
      region: "other",
    })
    .onConflictDoNothing();
}

async function upsertAnnouncement(announcement: {
  origin: string | null;
  destination: string | null;
  title: string;
  url: string | null;
  summary: string;
  kind: string;
  announcedStart: string | null;
  announcedEnd: string | null;
  externalId: string;
  publishedAt: string | null;
  sourceId: string;
}) {
  const database = dbOrThrow();
  if (announcement.origin) await ensureAirport(announcement.origin);
  if (announcement.destination) await ensureAirport(announcement.destination);
  const existing = await database
    .select({ id: routeAnnouncements.id })
    .from(routeAnnouncements)
    .where(
      and(
        eq(routeAnnouncements.sourceId, announcement.sourceId),
        eq(routeAnnouncements.externalId, announcement.externalId),
        announcement.origin
          ? eq(routeAnnouncements.originIata, announcement.origin)
          : isNull(routeAnnouncements.originIata),
        announcement.destination
          ? eq(routeAnnouncements.destinationIata, announcement.destination)
          : isNull(routeAnnouncements.destinationIata),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await database
      .update(routeAnnouncements)
      .set({ retrievedAt: new Date(), summary: announcement.summary, title: announcement.title })
      .where(eq(routeAnnouncements.id, existing[0].id));
    return;
  }
  await database.insert(routeAnnouncements).values({
    originIata: announcement.origin,
    destinationIata: announcement.destination,
    title: announcement.title,
    url: announcement.url,
    publishedAt: announcement.publishedAt ? new Date(announcement.publishedAt) : null,
    retrievedAt: new Date(),
    summary: announcement.summary,
    kind: announcement.kind,
    announcedStart: announcement.announcedStart,
    announcedEnd: announcement.announcedEnd,
    sourceId: announcement.sourceId,
    externalId: announcement.externalId,
  });
}

export async function storeSourceResult(result: SourceRunResult) {
  const database = dbOrThrow();
  for (const observation of result.observations) {
    await ensureAirport(observation.origin);
    await ensureAirport(observation.destination);
    const hash = observationHash(observation);
    const existing = await database
      .select({ id: routeObservations.id })
      .from(routeObservations)
      .where(
        and(
          eq(routeObservations.sourceId, observation.sourceId),
          eq(routeObservations.externalId, observation.externalId),
          eq(routeObservations.originIata, observation.origin),
          eq(routeObservations.destinationIata, observation.destination),
          eq(routeObservations.contentHash, hash),
        ),
      )
      .limit(1);
    const retrievedAt = new Date(observation.retrievedAt);
    if (existing[0]) {
      await database
        .update(routeObservations)
        .set({ lastRetrievedAt: retrievedAt })
        .where(eq(routeObservations.id, existing[0].id));
    } else {
      await database.insert(routeObservations).values({
        sourceId: observation.sourceId,
        url: observation.url,
        retrievedAt,
        lastRetrievedAt: retrievedAt,
        externalId: observation.externalId,
        originIata: observation.origin,
        destinationIata: observation.destination,
        observationKind: observation.kind,
        contentHash: hash,
        payload: observation,
      });
    }
  }

  for (const observation of result.observations.filter((item) => item.kind === "announcement")) {
    await upsertAnnouncement({
      origin: observation.origin,
      destination: observation.destination,
      title: observation.title ?? `${observation.origin} → ${observation.destination}`,
      url: observation.url ?? null,
      summary: observation.frequencyText
        ? `${observation.title ?? "Route announcement"} · ${observation.frequencyText}`
        : observation.title ?? "Route announcement",
      kind: observation.announcementKind ?? "other",
      announcedStart: observation.announcedStart ?? null,
      announcedEnd: observation.announcedEnd ?? null,
      externalId: observation.externalId,
      publishedAt: null,
      sourceId: result.sourceId,
    });
  }

  for (const announcement of result.announcements ?? []) {
    await upsertAnnouncement({ ...announcement, sourceId: result.sourceId });
  }

  if (result.replacedRuleSourceUrls && result.replacedRuleSourceUrls.length > 0) {
    await database.delete(programRules).where(inArray(programRules.sourceUrl, result.replacedRuleSourceUrls));
  }

  for (const rule of result.rules ?? []) {
    await database.insert(programRules).values({
      program: rule.program,
      ruleKey: rule.ruleKey,
      summary: rule.summary,
      value: rule.value,
      sourceUrl: rule.sourceUrl,
      retrievedAt: new Date(),
      effectiveDate: null,
    });
  }

  if (result.metrics && result.metrics.length > 0) {
    const period = result.metrics[0]?.periodStart;
    if (period) {
      await database
        .delete(routeMetrics)
        .where(and(eq(routeMetrics.sourceId, result.sourceId), eq(routeMetrics.periodStart, period)));
    }
    for (const metric of result.metrics) {
      await ensureAirport(metric.origin);
      await ensureAirport(metric.destination);
      await database.insert(routeMetrics).values({
        originIata: metric.origin,
        destinationIata: metric.destination,
        metricKind: "popularity",
        periodStart: metric.periodStart,
        periodEnd: metric.periodEnd,
        periodLabel: metric.periodLabel,
        value: metric.value,
        unit: "passengers",
        sourceId: result.sourceId,
        retrievedAt: new Date(),
        domesticComparable: metric.domesticComparable,
      });
    }
  }
}

function rowToObservation(payload: Observation, lastRetrievedAt: Date): Observation {
  return { ...payload, retrievedAt: lastRetrievedAt.toISOString() };
}

function projectionFromRow(row: typeof routes.$inferSelect): RouteProjection {
  return row.projection;
}

export async function reconcileStored(now = new Date()) {
  const database = dbOrThrow();
  const observationRows = await database.select().from(routeObservations);
  const routeRows = await database.select().from(routes);
  const observations = observationRows.map((row) => rowToObservation(row.payload, row.lastRetrievedAt));
  const previous = routeRows.map(projectionFromRow);
  const result = reconcileNetwork({
    observations,
    previous,
    now: now.toISOString(),
    thresholds: thresholdsFromEnv(),
  });

  for (const projection of result.projections) {
    await ensureAirport(projection.origin);
    await ensureAirport(projection.destination);
    await database
      .insert(routes)
      .values({
        originIata: projection.origin,
        destinationIata: projection.destination,
        status: projection.status,
        confidence: projection.confidence,
        endConfirmed: projection.endConfirmed,
        launchUnverified: projection.launchUnverified,
        seasonal: projection.seasonal,
        reasons: projection.reasons,
        firstSeenAt: new Date(projection.firstSeenAt),
        lastSeenAt: new Date(projection.lastSeenAt),
        firstScheduledDeparture: projection.firstScheduledDeparture,
        lastScheduledDeparture: projection.lastScheduledDeparture,
        announcedStartDate: projection.announcedStartDate,
        announcedEndDate: projection.announcedEndDate,
        announcedFrequencyPerWeek: projection.announcedFrequencyPerWeek,
        currentFrequencyPerWeek: projection.currentFrequencyPerWeek,
        previousFrequencyPerWeek: projection.previousFrequencyPerWeek,
        scheduleDays: projection.scheduleDays,
        scheduleHorizon: projection.scheduleHorizon,
        lastVerifiedAt: projection.lastVerifiedAt ? new Date(projection.lastVerifiedAt) : null,
        suspectedEndDate: projection.suspectedEndDate,
        latestMarketedDeparture: projection.latestMarketedDeparture,
        projection,
      })
      .onConflictDoUpdate({
        target: [routes.originIata, routes.destinationIata],
        set: {
          status: projection.status,
          confidence: projection.confidence,
          endConfirmed: projection.endConfirmed,
          launchUnverified: projection.launchUnverified,
          seasonal: projection.seasonal,
          reasons: projection.reasons,
          lastSeenAt: new Date(projection.lastSeenAt),
          firstScheduledDeparture: projection.firstScheduledDeparture,
          lastScheduledDeparture: projection.lastScheduledDeparture,
          announcedStartDate: projection.announcedStartDate,
          announcedEndDate: projection.announcedEndDate,
          announcedFrequencyPerWeek: projection.announcedFrequencyPerWeek,
          currentFrequencyPerWeek: projection.currentFrequencyPerWeek,
          previousFrequencyPerWeek: projection.previousFrequencyPerWeek,
          scheduleDays: projection.scheduleDays,
          scheduleHorizon: projection.scheduleHorizon,
          lastVerifiedAt: projection.lastVerifiedAt ? new Date(projection.lastVerifiedAt) : null,
          suspectedEndDate: projection.suspectedEndDate,
          latestMarketedDeparture: projection.latestMarketedDeparture,
          projection,
        },
      });
  }

  for (const change of result.changes) {
    await database.insert(routeSnapshots).values({
      originIata: change.origin,
      destinationIata: change.destination,
      capturedAt: now,
      projection: change.after,
    });
    await database.insert(routeChanges).values({
      originIata: change.origin,
      destinationIata: change.destination,
      changeType: change.type,
      detectedAt: now,
      summary: change.summary,
      confidence: change.confidence,
      before: change.before,
      after: change.after,
    });
  }

  await rebuildFlightInstances(observations);
  return { routes: result.projections.length, changes: result.changes.length };
}

async function rebuildFlightInstances(observations: Observation[]) {
  const database = dbOrThrow();
  const latest = new Map<string, Observation>();
  for (const observation of observations) {
    if (observation.kind !== "schedule_snapshot" || observation.successful === false) continue;
    const key = `${observation.sourceId}|${observation.origin}|${observation.destination}`;
    const previous = latest.get(key);
    if (!previous || observation.retrievedAt > previous.retrievedAt) latest.set(key, observation);
  }
  await database.delete(flightInstances);
  for (const snapshot of latest.values()) {
    for (const flight of snapshot.flights ?? []) {
      if (!flight.departureLocal || !flight.arrivalLocal) continue;
      await database.insert(flightInstances).values({
        originIata: snapshot.origin,
        destinationIata: snapshot.destination,
        operatingDate: flight.date,
        departureLocal: flight.departureLocal,
        arrivalLocal: flight.arrivalLocal,
        flightNumber: flight.flightNumber,
        sourceId: snapshot.sourceId,
        retrievedAt: new Date(snapshot.retrievedAt),
      });
    }
  }
}
