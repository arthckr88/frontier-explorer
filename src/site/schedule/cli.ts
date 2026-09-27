import { readFileSync, writeFileSync } from "node:fs";
import { DateTime } from "luxon";
import airportData from "../../../data/airports.json";
import { loadEnvFile } from "@/lib/env";
import { scheduleToday } from "@/site/time";
import { cacheTtlMs, fileCache, queryCacheKey } from "@/site/schedule/cache";
import { DEFAULT_MAX_PAGES, DEFAULT_MAX_RUN_COST_USD } from "@/site/schedule/budget";
import { createAeroTransport, FlightAwareScheduleProvider, redactSecrets } from "@/site/schedule/flightaware";
import { mergeScheduleEvidence, type ScheduleWindowResult, type StoredFlight } from "@/site/schedule/merge";
import { DEFAULT_EXTENDED_DAYS, DEFAULT_NEAR_DAYS, DEFAULT_PLANNING_DAYS, type ScheduleMode } from "@/site/schedule/plan";

loadEnvFile();

const mode = readMode(process.argv[2]);
const importing = process.argv.includes("--import");
const apiKey = process.env.FLIGHTAWARE_API_KEY ?? "";
const provider = new FlightAwareScheduleProvider();
const today = scheduleToday(DateTime.now());
const planInput = {
  today,
  mode,
  nearDays: envNumber("SCHEDULE_NEAR_DAYS", DEFAULT_NEAR_DAYS),
  planningDays: envNumber("SCHEDULE_PLANNING_DAYS", DEFAULT_PLANNING_DAYS),
  extendedDays: envNumber("SCHEDULE_EXTENDED_DAYS", DEFAULT_EXTENDED_DAYS),
  maxPages: envNumber("FLIGHTAWARE_MAX_PAGES", DEFAULT_MAX_PAGES),
  maxCostUsd: envNumber("FLIGHTAWARE_MAX_RUN_COST_USD", DEFAULT_MAX_RUN_COST_USD),
};
console.log(redactSecrets(provider.dryRun(planInput, apiKey.length > 0), apiKey));

if (!importing) {
  console.log("Live import was not run.");
  process.exit(0);
}

if (!apiKey) {
  console.error("Waiting on FLIGHTAWARE_API_KEY. No FlightAware request was sent.");
  process.exit(1);
}

importSchedules(apiKey).catch((error: unknown) => {
  console.error(redactSecrets(error instanceof Error ? error.message : "FlightAware import failed.", apiKey));
  process.exit(1);
});

async function importSchedules(key: string) {
  const plan = provider.plan(planInput);
  const zones = new Map((airportData as { iata: string; timezone: string }[]).map((airport) => [airport.iata, airport.timezone]));
  const cache = fileCache(new URL("../../../data/flightaware-cache.json", import.meta.url).pathname, (cacheKey) => {
    const query = plan.allowedQueries.find((item) => queryCacheKey(item) === cacheKey);
    return query ? cacheTtlMs(query, today) : 24 * 60 * 60 * 1000;
  });
  const transport = createAeroTransport(key);
  const deps = { apiKey: key, cache, transport, zones, capUsd: planInput.maxCostUsd, spentUsd: 0 };
  try {
    const operator = await provider.verifyOperator(deps);
    deps.spentUsd += operator.costUsd;
    console.log(`Operator ${operator.icao} ${operator.name}. Cached ${operator.cached}.`);
  } catch (error) {
    console.error(redactSecrets(error instanceof Error ? error.message : "Operator lookup failed.", key));
    process.exit(1);
  }
  const windows: ScheduleWindowResult[] = [];
  for (const query of plan.allowedQueries) {
    if (query.endpoint !== "schedules" || !query.origin || !query.destination || !query.dateStart || !query.dateEnd) continue;
    try {
      const result = await provider.fetchSchedule(query, deps);
      deps.spentUsd += result.costUsd;
      windows.push({
        origin: query.origin,
        destination: query.destination,
        dateStart: query.dateStart,
        dateEnd: query.dateEnd,
        complete: result.complete,
        flights: result.flights,
      });
      console.log(`${query.origin}-${query.destination} ${query.dateStart}/${query.dateEnd}: ${result.flights.length} flights, cached ${result.cached}, complete ${result.complete}`);
    } catch (error) {
      console.error(redactSecrets(error instanceof Error ? error.message : "Schedule request stopped.", key));
      break;
    }
  }
  const file = new URL("../../../data/flights.json", import.meta.url);
  const store = JSON.parse(readFileSync(file, "utf8")) as { flights: StoredFlight[]; checked?: string[]; blocked?: string[] };
  const merged = mergeScheduleEvidence(
    { flights: store.flights ?? [], checked: store.checked ?? [], blocked: store.blocked ?? [] },
    windows,
  );
  store.flights = merged.flights;
  store.checked = merged.checked;
  store.blocked = merged.blocked;
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
  writeFileSync(new URL("../../../data/schedule-disagreements.json", import.meta.url), `${JSON.stringify({ disagreements: merged.disagreements }, null, 2)}\n`);
  console.log(`Merged ${windows.length} windows. Disagreements ${merged.disagreements.length}. Live import finished.`);
}

function readMode(value: string | undefined): ScheduleMode {
  if (value === "planning" || value === "extended" || value === "full" || value === "near") return value;
  return "near";
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
