/** AeroAPI prices from the public fee table, spec 4.17.1. A result set is up to 15 records. */

export const RESULT_SET_SIZE = 15;
export const SCHEDULE_RESULT_SET_USD = 0.02;
export const OPERATOR_RESULT_SET_USD = 0.015;
export const DEFAULT_MAX_RUN_COST_USD = 4;
export const DEFAULT_MAX_PAGES = 2;
export const MAX_SCHEDULE_SPAN_DAYS = 20;

export type ScheduleEndpoint = "operator" | "schedules";

export type ScheduleQuery = {
  provider: "flightaware";
  endpoint: ScheduleEndpoint;
  airline: "FFT";
  origin?: string;
  destination?: string;
  dateStart?: string;
  dateEnd?: string;
  maxPages: number;
};

export function queryMaxCostUsd(query: ScheduleQuery): number {
  if (query.endpoint === "operator") return OPERATOR_RESULT_SET_USD;
  return query.maxPages * SCHEDULE_RESULT_SET_USD;
}

export function maxResultSets(queries: ScheduleQuery[]): number {
  return queries.reduce((sum, query) => sum + (query.endpoint === "operator" ? 1 : query.maxPages), 0);
}

export function maxCostUsd(queries: ScheduleQuery[]): number {
  return roundUsd(queries.reduce((sum, query) => sum + queryMaxCostUsd(query), 0));
}

export function queriesBeforeCap(queries: ScheduleQuery[], capUsd: number): { allowed: ScheduleQuery[]; stopped: boolean; maxCostUsd: number } {
  const allowed: ScheduleQuery[] = [];
  let spent = 0;
  for (const query of queries) {
    const next = queryMaxCostUsd(query);
    if (spent + next > capUsd + 1e-9) {
      return { allowed, stopped: true, maxCostUsd: roundUsd(spent) };
    }
    spent += next;
    allowed.push(query);
  }
  return { allowed, stopped: false, maxCostUsd: roundUsd(spent) };
}

export function roundUsd(value: number): number {
  return Math.round(value * 1000) / 1000;
}
