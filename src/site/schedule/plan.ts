import { PRIORITY_AIRPORTS, addDays, verificationPairs } from "@/site/view";
import {
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RUN_COST_USD,
  MAX_SCHEDULE_SPAN_DAYS,
  type ScheduleQuery,
  maxCostUsd,
  maxResultSets,
  queriesBeforeCap,
} from "@/site/schedule/budget";

export const DEFAULT_NEAR_DAYS = 14;
export const DEFAULT_PLANNING_DAYS = 60;
export const DEFAULT_EXTENDED_DAYS = 180;
export const FULL_YEAR_DAYS = 365;

export type ScheduleMode = "near" | "planning" | "extended" | "full";

export type SchedulePlanInput = {
  today: string;
  mode: ScheduleMode;
  nearDays?: number;
  planningDays?: number;
  extendedDays?: number;
  maxPages?: number;
  maxCostUsd?: number;
  includeOperatorLookup?: boolean;
};

export type SchedulePlan = {
  provider: "flightaware";
  mode: ScheduleMode;
  airports: string[];
  windowStart: string;
  windowEndInclusive: string;
  days: number;
  queries: ScheduleQuery[];
  allowedQueries: ScheduleQuery[];
  stoppedByCostCap: boolean;
  maxPages: number;
  maximumResultSets: number;
  maximumCostUsd: number;
  cadence: string;
};

export function planFlightAware(input: SchedulePlanInput): SchedulePlan {
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  const cap = input.maxCostUsd ?? DEFAULT_MAX_RUN_COST_USD;
  const days = daysForMode(input);
  const windowEndInclusive = addDays(input.today, days - 1) ?? input.today;
  const pairs = verificationPairs();
  const queries: ScheduleQuery[] = [];
  if (input.includeOperatorLookup !== false) {
    queries.push({ provider: "flightaware", endpoint: "operator", airline: "FFT", maxPages: 1 });
  }
  for (const chunk of chunkWindow(input.today, days)) {
    for (const pair of pairs) {
      queries.push({
        provider: "flightaware",
        endpoint: "schedules",
        airline: "FFT",
        origin: pair.origin,
        destination: pair.destination,
        dateStart: chunk.start,
        dateEnd: chunk.end,
        maxPages,
      });
    }
  }
  const guarded = queriesBeforeCap(queries, cap);
  return {
    provider: "flightaware",
    mode: input.mode,
    airports: [...PRIORITY_AIRPORTS],
    windowStart: input.today,
    windowEndInclusive,
    days,
    queries,
    allowedQueries: guarded.allowed,
    stoppedByCostCap: guarded.stopped,
    maxPages,
    maximumResultSets: maxResultSets(guarded.allowed),
    maximumCostUsd: maxCostUsd(guarded.allowed),
    cadence: cadenceFor(input.mode),
  };
}

export function daysForMode(input: SchedulePlanInput): number {
  if (input.mode === "near") return positive(input.nearDays, DEFAULT_NEAR_DAYS);
  if (input.mode === "planning") return positive(input.planningDays, DEFAULT_PLANNING_DAYS);
  if (input.mode === "extended") return positive(input.extendedDays, DEFAULT_EXTENDED_DAYS);
  return FULL_YEAR_DAYS;
}

export function chunkWindow(start: string, days: number): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let offset = 0;
  while (offset < days) {
    const span = Math.min(MAX_SCHEDULE_SPAN_DAYS, days - offset);
    const chunkStart = addDays(start, offset);
    const chunkEnd = addDays(start, offset + span);
    if (!chunkStart || !chunkEnd) break;
    chunks.push({ start: chunkStart, end: chunkEnd });
    offset += span;
  }
  return chunks;
}

export function formatDryRun(plan: SchedulePlan, options: { apiKeySet: boolean } ): string {
  const scheduleQueries = plan.allowedQueries.filter((query) => query.endpoint === "schedules");
  const lines = [
    `provider: ${plan.provider}`,
    `airports: ${plan.airports.join(", ")}`,
    `window: ${plan.windowStart} through ${plan.windowEndInclusive} (${plan.days} days, ${plan.mode})`,
    `queries planned: ${plan.queries.length}`,
    `queries allowed before cost cap: ${plan.allowedQueries.length}`,
    `max pages: ${plan.maxPages}`,
    `maximum possible result sets: ${plan.maximumResultSets}`,
    `maximum estimated API cost: $${plan.maximumCostUsd.toFixed(3)}`,
    `cadence: ${plan.cadence}`,
    `airline filter: FFT`,
    `endpoint: GET /schedules/{date_start}/{date_end} at $0.020 per result set`,
    `operator check: GET /operators/FFT at $0.015, expected ICAO FFT, not sent in dry-run`,
    `schedule queries in this capped plan: ${scheduleQueries.length}`,
    options.apiKeySet ? "FLIGHTAWARE_API_KEY is set. This dry-run did not call FlightAware." : "FLIGHTAWARE_API_KEY is not set. No FlightAware request can be sent.",
    plan.stoppedByCostCap ? "The cost cap stops this run before every planned query." : "This plan fits under the cost cap.",
  ];
  return lines.join("\n");
}

function cadenceFor(mode: ScheduleMode): string {
  if (mode === "near") return "weekly import at most; not hourly. Near-term cache expires after 1 day.";
  if (mode === "planning") return "weekly or when the 15-60 day cache is older than 7 days. Not hourly.";
  if (mode === "extended") return "manual or about monthly. Not hourly.";
  return "manual only. Not hourly and not a scheduled workflow.";
}

function positive(value: number | undefined, fallback: number): number {
  if (!value || value < 1) return fallback;
  return Math.floor(value);
}
