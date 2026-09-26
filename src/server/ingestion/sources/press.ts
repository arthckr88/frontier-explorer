import { getEnv } from "@/lib/env";
import { fetchText } from "@/server/ingestion/http";
import { parseNewsroomFeed } from "@/server/ingestion/parse/newsroom";
import type { SourceRunResult } from "@/server/ingestion/types";

export async function fetchAirportPress(): Promise<SourceRunResult> {
  const urls = (getEnv().AIRPORT_PRESS_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    return {
      sourceId: "airport-press",
      status: "skipped",
      observations: [],
      detail: "No AIRPORT_PRESS_URLS configured. Add public airport press or RSS URLs to corroborate launches.",
      latencyMs: 0,
      recordsObserved: 0,
    };
  }
  const started = Date.now();
  const observations = [];
  const errors: string[] = [];
  for (const url of urls) {
    const response = await fetchText(url);
    if (!response.ok) {
      errors.push(`${url}: ${response.error ?? response.status}`);
      continue;
    }
    const retrievedAt = new Date().toISOString();
    const parsed = parseNewsroomFeed(response.body, retrievedAt).map((observation) => ({
      ...observation,
      sourceId: "airport-press",
      sourceName: "Airport press",
      sourceTier: 2 as const,
      sourceKind: "airport_press" as const,
    }));
    observations.push(...parsed);
  }
  return {
    sourceId: "airport-press",
    status: errors.length && observations.length === 0 ? "failure" : errors.length ? "partial" : "success",
    observations,
    error: errors.join(" | ") || undefined,
    latencyMs: Date.now() - started,
    recordsObserved: observations.length,
  };
}
