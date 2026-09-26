import { z } from "zod";
import { getEnv } from "@/lib/env";
import { fetchText } from "@/server/ingestion/http";
import type { SourceRunResult } from "@/server/ingestion/types";

const countSchema = z.array(z.object({ year: z.string().optional(), month: z.string().optional() }));
const rowSchema = z.array(
  z.object({
    usg_apt: z.string(),
    fg_apt: z.string(),
    passengers: z.coerce.number(),
  }),
);

async function soda(base: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchText(url.toString(), { minDelayMs: 300, timeoutMs: 40_000 });
}

export async function fetchPopularity(): Promise<SourceRunResult> {
  const env = getEnv();
  const started = Date.now();
  const base = env.BTS_INTERNATIONAL_RESOURCE_URL;
  const errors: string[] = [];
  const years = await soda(base, {
    $select: "year",
    $where: "carrier='F9' AND type='Passengers'",
    $group: "year",
    $order: "year DESC",
    $limit: "1",
  });
  if (!years.ok) {
    return {
      sourceId: "bts-popularity",
      status: "failure",
      observations: [],
      error: years.error,
      detail: "International T-100 request failed. No passenger counts were invented.",
      latencyMs: Date.now() - started,
      recordsObserved: 0,
    };
  }
  let year = "";
  let month = "";
  try {
    const parsedYears = countSchema
      .parse(JSON.parse(years.body))
      .map((row) => Number(row.year))
      .filter((value) => Number.isInteger(value));
    year = String(Math.max(...parsedYears));
  } catch (error) {
    return failure(error, started);
  }
  if (!/^\d{4}$/.test(year)) return failure("BTS returned no Frontier international year.", started);
  const months = await soda(base, {
    $select: "month",
    $where: `carrier='F9' AND type='Passengers' AND year='${year}'`,
    $group: "month",
    $limit: "12",
  });
  if (!months.ok) return failure(months.error ?? "month query failed", started);
  try {
    const parsedMonths = countSchema
      .parse(JSON.parse(months.body))
      .map((row) => Number(row.month))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 12);
    month = String(Math.max(...parsedMonths));
  } catch (error) {
    return failure(error, started);
  }
  if (!/^\d{1,2}$/.test(month)) return failure("BTS returned no Frontier international month.", started);
  const rows = await soda(base, {
    $select: "usg_apt,fg_apt,sum(total) as passengers",
    $where: `carrier='F9' AND type='Passengers' AND year='${year}' AND month='${month}'`,
    $group: "usg_apt,fg_apt",
    $limit: "5000",
  });
  if (!rows.ok) return failure(rows.error ?? "row query failed", started);
  let parsed;
  try {
    parsed = rowSchema.parse(JSON.parse(rows.body));
  } catch (error) {
    return failure(error, started);
  }
  const periodStart = `${year}-${month.padStart(2, "0")}-01`;
  const periodLabel = `BTS T-100 international segment ${year}-${month.padStart(2, "0")} (Frontier, carrier F9)`;
  if (!env.BTS_DOMESTIC_RESOURCE_URL) {
    errors.push("Domestic T-100 is not configured. Domestic popularity is unavailable rather than zero.");
  }
  return {
    sourceId: "bts-popularity",
    status: "success",
    observations: [],
    metrics: parsed
      .filter((row) => row.passengers > 0 && row.usg_apt.length === 3 && row.fg_apt.length === 3)
      .map((row) => ({
        origin: row.usg_apt.toUpperCase(),
        destination: row.fg_apt.toUpperCase(),
        value: Math.round(row.passengers),
        periodStart,
        periodEnd: periodStart,
        periodLabel,
        domesticComparable: false,
      })),
    detail: errors.join(" "),
    latencyMs: Date.now() - started,
    recordsObserved: parsed.length,
  };
}

function failure(error: unknown, started: number): SourceRunResult {
  return {
    sourceId: "bts-popularity",
    status: "failure",
    observations: [],
    error: error instanceof Error ? error.message : String(error),
    detail: "No passenger counts were invented.",
    latencyMs: Date.now() - started,
    recordsObserved: 0,
  };
}
