import { fetchText } from "@/server/ingestion/http";
import { matchFlightFromLinks, parseMarketedSamples } from "@/server/ingestion/parse/marketed";
import type { SourceRunResult } from "@/server/ingestion/types";

const SITEMAP = "https://flights.flyfrontier.com/en/sitemap/flights-from-city/page-1";

export async function fetchRoutePages(
  airports: { iata: string; city: string }[],
): Promise<SourceRunResult> {
  const started = Date.now();
  const index = await fetchText(SITEMAP);
  if (!index.ok) {
    return {
      sourceId: "frontier-route-pages",
      status: "failure",
      observations: [],
      error: index.error ?? `HTTP ${index.status}`,
      detail: "Could not read the public flights-from sitemap. No route pages were treated as a network.",
      latencyMs: Date.now() - started,
      recordsObserved: 0,
    };
  }
  const links = matchFlightFromLinks(index.body, airports);
  const unique = [...new Map(links.map((link) => [link.url, link])).values()];
  const observations = [];
  const errors: string[] = [];
  const retrievedAt = new Date().toISOString();
  for (const link of unique) {
    const page = await fetchText(link.url);
    if (!page.ok) {
      errors.push(`${link.url}: ${page.error ?? page.status}`);
      continue;
    }
    observations.push(...parseMarketedSamples(page.body, link.url, retrievedAt));
  }
  const status = unique.length === 0 ? "partial" : errors.length && observations.length === 0 ? "failure" : errors.length ? "partial" : "success";
  return {
    sourceId: "frontier-route-pages",
    status,
    observations,
    error: errors.join(" | ") || undefined,
    detail:
      "Parsed IATA-coded marketed samples only. City-name lists and the SEO sitemap were not promoted to confirmed nonstops.",
    latencyMs: Date.now() - started,
    recordsObserved: observations.length,
  };
}
