import { queryCacheKey, type QueryCache } from "@/site/schedule/cache";
import { OPERATOR_RESULT_SET_USD, SCHEDULE_RESULT_SET_USD, queryMaxCostUsd, type ScheduleQuery } from "@/site/schedule/budget";
import { formatDryRun, planFlightAware, type SchedulePlan, type SchedulePlanInput } from "@/site/schedule/plan";
import { normalizeAeroSchedules, type AeroScheduleRow } from "@/site/schedule/normalize";
import type { Observation } from "@/site/view";

export const AEROAPI_ORIGIN = "https://aeroapi.flightaware.com/aeroapi";
export const EXPECTED_OPERATOR_ICAO = "FFT";

export type AeroTransport = (request: { path: string; query: Record<string, string> }) => Promise<{
  status: number;
  body: unknown;
  numPages: number;
}>;

export type FlightAwareDeps = {
  now?: Date;
  apiKey?: string | null;
  cache: QueryCache;
  transport?: AeroTransport;
  zones?: Map<string, string>;
  spentUsd?: number;
  capUsd?: number;
};

export class FlightAwareScheduleProvider {
  readonly id = "flightaware" as const;

  plan(input: SchedulePlanInput): SchedulePlan {
    return planFlightAware(input);
  }

  dryRun(input: SchedulePlanInput, apiKeySet: boolean): string {
    return formatDryRun(this.plan(input), { apiKeySet });
  }

  async verifyOperator(deps: FlightAwareDeps): Promise<{ icao: string; name: string; cached: boolean; costUsd: number }> {
    const query: ScheduleQuery = { provider: "flightaware", endpoint: "operator", airline: "FFT", maxPages: 1 };
    const loaded = await this.load(query, deps);
    const body = loaded.body as { icao?: string | null; name?: string | null };
    const icao = (body.icao || "").toUpperCase();
    if (icao !== EXPECTED_OPERATOR_ICAO) {
      throw new Error(`FlightAware operator lookup returned ${icao || "no ICAO"}. Expected ${EXPECTED_OPERATOR_ICAO}. No schedule query was sent.`);
    }
    return { icao, name: body.name || "", cached: loaded.cached, costUsd: loaded.costUsd };
  }

  async fetchSchedule(query: ScheduleQuery, deps: FlightAwareDeps): Promise<{ flights: Observation[]; complete: boolean; cached: boolean; costUsd: number }> {
    if (query.endpoint !== "schedules" || !query.origin || !query.destination || !query.dateStart || !query.dateEnd) {
      throw new Error("Schedule query is missing a corridor or window.");
    }
    const loaded = await this.load(query, deps);
    const body = loaded.body as { scheduled?: AeroScheduleRow[]; links?: { next?: string | null } | null };
    const rows = Array.isArray(body.scheduled) ? body.scheduled : [];
    const flights = normalizeAeroSchedules(rows, deps.zones ?? new Map(), new Date().toISOString(), {
      origin: query.origin,
      destination: query.destination,
    });
    const complete = !body.links?.next;
    return { flights, complete, cached: loaded.cached, costUsd: loaded.costUsd };
  }

  private async load(query: ScheduleQuery, deps: FlightAwareDeps): Promise<{ body: unknown; cached: boolean; costUsd: number; numPages: number }> {
    const now = deps.now ?? new Date();
    const key = queryCacheKey(query);
    const hit = deps.cache.get(key, now);
    if (hit) return { body: hit.body, cached: true, costUsd: 0, numPages: hit.numPages };
    const apiKey = deps.apiKey ?? null;
    if (!apiKey) throw new Error("FLIGHTAWARE_API_KEY is not set. No FlightAware request was sent.");
    const cap = deps.capUsd ?? Number.POSITIVE_INFINITY;
    const spent = deps.spentUsd ?? 0;
    const nextCost = queryMaxCostUsd(query);
    if (spent + nextCost > cap + 1e-9) {
      throw new Error(`Stopped before a FlightAware request that could exceed the $${cap.toFixed(2)} cap.`);
    }
    if (!deps.transport) throw new Error("FlightAware transport is not configured.");
    const response = await deps.transport({ path: pathFor(query), query: queryParams(query) });
    const unit = query.endpoint === "operator" ? OPERATOR_RESULT_SET_USD : SCHEDULE_RESULT_SET_USD;
    const costUsd = response.numPages * unit;
    deps.cache.set({ key, fetchedAt: now.toISOString(), numPages: response.numPages, body: response.body });
    return { body: response.body, cached: false, costUsd, numPages: response.numPages };
  }
}

export function createAeroTransport(apiKey: string): AeroTransport {
  return async ({ path, query }) => {
    const url = new URL(path, `${AEROAPI_ORIGIN}/`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: "application/json", "x-apikey": apiKey } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      throw new Error(redactSecrets(`FlightAware request failed for ${path}: ${message}`, apiKey));
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(redactSecrets(`FlightAware HTTP ${response.status} for ${path}`, apiKey));
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(redactSecrets(`FlightAware returned malformed JSON for ${path}`, apiKey));
    }
    const record = body as { num_pages?: number };
    return { status: response.status, body, numPages: record.num_pages && record.num_pages > 0 ? record.num_pages : 1 };
  };
}

export function redactSecrets(text: string, secret: string | null | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

function pathFor(query: ScheduleQuery): string {
  if (query.endpoint === "operator") return "/operators/FFT";
  return `/schedules/${query.dateStart}/${query.dateEnd}`;
}

function queryParams(query: ScheduleQuery): Record<string, string> {
  if (query.endpoint === "operator") return {};
  return {
    airline: "FFT",
    origin: query.origin ?? "",
    destination: query.destination ?? "",
    include_codeshares: "false",
    include_regional: "false",
    max_pages: String(query.maxPages),
  };
}
