import { FrontierAvailabilityProvider } from "@/site/availability/provider";
import { AVAILABILITY_SOURCE, type AvailabilityQuery, type AvailabilitySearchResult } from "@/site/availability/types";

export type AvailabilityCacheEntry = {
  key: string;
  origin: string;
  destination: string;
  date: string;
  retrievedAt: string;
  expiresAt: string;
  source: typeof AVAILABILITY_SOURCE;
  result: AvailabilitySearchResult;
};

export type AvailabilityCache = {
  get(key: string, now: Date): AvailabilityCacheEntry | null;
  set(entry: AvailabilityCacheEntry): void;
};

export function availabilityCacheKey(query: AvailabilityQuery): string {
  return `${query.origin}|${query.destination}|${query.date}`;
}

export function cacheAvailability(
  result: AvailabilitySearchResult,
  retrievedAt: Date,
  ttlMs: number,
): AvailabilityCacheEntry {
  return {
    key: availabilityCacheKey(result),
    origin: result.origin,
    destination: result.destination,
    date: result.date,
    retrievedAt: retrievedAt.toISOString(),
    expiresAt: new Date(retrievedAt.getTime() + ttlMs).toISOString(),
    source: AVAILABILITY_SOURCE,
    result,
  };
}

export async function searchCached(
  provider: FrontierAvailabilityProvider,
  cache: AvailabilityCache,
  query: AvailabilityQuery,
  now: Date,
  ttlMs: number,
): Promise<AvailabilitySearchResult> {
  const hit = cache.get(availabilityCacheKey(query), now);
  if (hit) return hit.result;
  const result = await provider.search(query);
  cache.set(cacheAvailability(result, now, ttlMs));
  return result;
}

export function memoryAvailabilityCache(): AvailabilityCache {
  const rows = new Map<string, AvailabilityCacheEntry>();
  return {
    get(key, now) {
      const row = rows.get(key);
      if (!row) return null;
      if (Date.parse(row.expiresAt) <= now.getTime()) return null;
      return row;
    },
    set(entry) {
      rows.set(entry.key, entry);
    },
  };
}
