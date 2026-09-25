import { z } from "zod";
import { getEnv } from "@/lib/env";
import { fetchText } from "@/server/ingestion/http";
import type { SourceRunResult } from "@/server/ingestion/types";
import type { Observation } from "@/types/domain";

const timetableSchema = z.array(
  z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    date: z.string(),
    departureLocal: z.string().optional(),
    arrivalLocal: z.string().optional(),
    flightNumber: z.string().optional(),
    windowStart: z.string().optional(),
    windowEnd: z.string().optional(),
  }),
);

export async function fetchSchedule(): Promise<SourceRunResult> {
  const env = getEnv();
  if (!env.TIMETABLE_API_URL) {
    return {
      sourceId: "frontier-schedule",
      status: "skipped",
      observations: [],
      detail:
        "No timetable API is configured. Frontier booking inventory and undocumented private APIs are not called. Set TIMETABLE_API_URL and TIMETABLE_API_KEY to enable a tier-3 schedule source.",
      latencyMs: 0,
      recordsObserved: 0,
    };
  }
  const started = Date.now();
  const url = new URL(env.TIMETABLE_API_URL);
  const headers: Record<string, string> = {};
  if (env.TIMETABLE_API_KEY) headers.authorization = `Bearer ${env.TIMETABLE_API_KEY}`;
  const response = await fetchText(url.toString(), { minDelayMs: 0, headers });
  if (!response.ok) {
    return {
      sourceId: "frontier-schedule",
      status: "failure",
      observations: [],
      error: response.error,
      latencyMs: Date.now() - started,
      recordsObserved: 0,
    };
  }
  let parsed: z.infer<typeof timetableSchema>;
  try {
    parsed = timetableSchema.parse(JSON.parse(response.body));
  } catch (error) {
    return {
      sourceId: "frontier-schedule",
      status: "failure",
      observations: [],
      error: error instanceof Error ? error.message : "Timetable payload did not match the expected schema.",
      latencyMs: Date.now() - started,
      recordsObserved: 0,
    };
  }
  const retrievedAt = new Date().toISOString();
  const grouped = new Map<string, Observation>();
  for (const flight of parsed) {
    const origin = flight.origin.toUpperCase();
    const destination = flight.destination.toUpperCase();
    const key = `${origin}-${destination}`;
    const existing = grouped.get(key) ?? {
      id: key,
      sourceId: "frontier-schedule",
      sourceName: "Timetable API",
      sourceTier: 3 as const,
      sourceKind: "timetable_api" as const,
      url: url.toString(),
      retrievedAt,
      externalId: `timetable-${retrievedAt.slice(0, 10)}`,
      origin,
      destination,
      kind: "schedule_snapshot" as const,
      successful: true,
      flights: [],
      windowStart: flight.windowStart,
      windowEnd: flight.windowEnd,
    };
    existing.flights = [
      ...(existing.flights ?? []),
      {
        date: flight.date.slice(0, 10),
        departureLocal: flight.departureLocal,
        arrivalLocal: flight.arrivalLocal,
        flightNumber: flight.flightNumber,
      },
    ];
    grouped.set(key, existing);
  }
  return {
    sourceId: "frontier-schedule",
    status: "success",
    observations: [...grouped.values()],
    detail: "Tier-3 timetable observations. These are not Frontier-official schedule evidence.",
    latencyMs: Date.now() - started,
    recordsObserved: parsed.length,
  };
}
