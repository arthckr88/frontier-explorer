import { getDb } from "@/server/db/client";
import { airports, savedRoutes } from "@/server/db/schema";
import { fetchPopularity } from "@/server/ingestion/sources/bts";
import { fetchNewsroom } from "@/server/ingestion/sources/newsroom";
import { fetchAirportPress } from "@/server/ingestion/sources/press";
import { fetchPrograms } from "@/server/ingestion/sources/programs";
import { fetchRoutePages } from "@/server/ingestion/sources/route-pages";
import { fetchSchedule } from "@/server/ingestion/sources/schedule";
import { PRIORITY_AIRPORTS } from "@/server/preferences/defaults";
import { recordSyncRun, reconcileStored, storeSourceResult } from "@/server/jobs/persist";
import type { SourceRunResult } from "@/server/ingestion/types";
import { inArray } from "drizzle-orm";


export const JOBS = [
  "priority",
  "schedules",
  "announcements",
  "programs",
  "popularity",
  "reconcile",
  "all",
] as const;

export type JobName = (typeof JOBS)[number];

async function runSource(job: string, loader: () => Promise<SourceRunResult>) {
  const startedAt = new Date();
  try {
    const result = await loader();
    await storeSourceResult(result);
    await recordSyncRun({
      job,
      sourceId: result.sourceId,
      startedAt,
      status: result.status,
      recordsObserved: result.recordsObserved,
      latencyMs: result.latencyMs,
      error: result.error,
      detail: result.detail,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await recordSyncRun({
      job,
      startedAt,
      status: "failure",
      recordsObserved: 0,
      latencyMs: Date.now() - startedAt.getTime(),
      error: message,
    });
    return null;
  }
}

async function priorityAirports() {
  const database = getDb();
  if (!database) return PRIORITY_AIRPORTS.map((iata) => ({ iata, city: iata }));
  const saved = await database.select().from(savedRoutes);
  const codes = new Set<string>(PRIORITY_AIRPORTS);
  for (const route of saved) {
    codes.add(route.originIata);
    codes.add(route.destinationIata);
  }
  const rows = await database
    .select({ iata: airports.iata, city: airports.city })
    .from(airports)
    .where(inArray(airports.iata, [...codes]));
  return rows;
}

export async function runJob(job: JobName) {
  const results: { sourceId?: string; status: string; records: number; detail?: string; error?: string }[] = [];
  const note = async (result: SourceRunResult | null) => {
    if (!result) {
      results.push({ status: "failure", records: 0, error: "Source threw before returning a result." });
      return;
    }
    results.push({
      sourceId: result.sourceId,
      status: result.status,
      records: result.recordsObserved,
      detail: result.detail,
      error: result.error,
    });
  };

  if (job === "priority" || job === "all") {
    const targets = await priorityAirports();
    await note(await runSource("priority", () => fetchRoutePages(targets)));
  }
  if (job === "schedules" || job === "all") {
    await note(await runSource("schedules", fetchSchedule));
  }
  if (job === "announcements" || job === "all") {
    await note(await runSource("announcements", fetchNewsroom));
    await note(await runSource("announcements", fetchAirportPress));
  }
  if (job === "programs" || job === "all") {
    await note(await runSource("programs", fetchPrograms));
  }
  if (job === "popularity" || job === "all") {
    await note(await runSource("popularity", fetchPopularity));
  }
  let reconciliation = { routes: 0, changes: 0 };
  if (job !== "programs") {
    const startedAt = new Date();
    try {
      reconciliation = await reconcileStored();
      await recordSyncRun({
        job: "reconcile",
        startedAt,
        status: "success",
        recordsObserved: reconciliation.changes,
        latencyMs: Date.now() - startedAt.getTime(),
        detail: `${reconciliation.routes} route projections, ${reconciliation.changes} new change events.`,
      });
    } catch (error) {
      await recordSyncRun({
        job: "reconcile",
        startedAt,
        status: "failure",
        recordsObserved: 0,
        latencyMs: Date.now() - startedAt.getTime(),
        error: error instanceof Error ? error.message : "Reconcile failed",
      });
      throw error;
    }
  }
  return { results, reconciliation };
}

export async function dueJobs(lastSuccess: Record<string, Date | null>, now = new Date()): Promise<JobName[]> {
  const { getEnv } = await import("@/lib/env");
  const env = getEnv();
  const due: JobName[] = [];
  const check = (job: JobName, hours: number) => {
    const last = lastSuccess[job];
    if (!last || now.getTime() - last.getTime() >= hours * 3_600_000) due.push(job);
  };
  check("priority", env.SYNC_PRIORITY_HOURS);
  check("schedules", env.SYNC_SCHEDULE_HOURS);
  check("announcements", env.SYNC_ANNOUNCEMENTS_HOURS);
  check("programs", env.SYNC_PROGRAMS_HOURS);
  check("reconcile", env.SYNC_RECONCILE_HOURS);
  const popularity = lastSuccess.popularity;
  if (!popularity || now.getTime() - popularity.getTime() >= env.SYNC_POPULARITY_DAYS * 86_400_000) {
    due.push("popularity");
  }
  return due;
}

export async function latestSuccessByJob() {
  const database = getDb();
  if (!database) return {};
  const rows = await database.select().from((await import("@/server/db/schema")).syncRuns);
  const latest: Record<string, Date | null> = {};
  for (const row of rows) {
    if (row.status !== "success" && row.status !== "partial" && row.status !== "skipped") continue;
    const current = latest[row.job];
    if (!current || row.startedAt > current) latest[row.job] = row.startedAt;
  }
  return latest;
}
