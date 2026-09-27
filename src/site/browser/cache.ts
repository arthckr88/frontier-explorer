import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addDays } from "@/site/view";
import { sanitizeBrowserResult } from "@/site/browser/sanitize";
import { BROWSER_SOURCE, FARE_TTL_LATER_MS, FARE_TTL_NEAR_MS, type BrowserQuery, type BrowserResult } from "@/site/browser/types";

export type BrowserCacheEntry = BrowserResult & {
  expiresAt: string;
};

export function cachePath(root: string, query: BrowserQuery): string {
  return join(root, `${query.origin}-${query.destination}-${query.date}.json`);
}

export function fareTtlMs(travelDate: string, today: string): number {
  const tomorrow = addDays(today, 1);
  if (travelDate === today || travelDate === tomorrow) return FARE_TTL_NEAR_MS;
  return FARE_TTL_LATER_MS;
}

export function readFreshCache(file: string, now: Date): BrowserCacheEntry | null {
  let parsed: BrowserCacheEntry;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as BrowserCacheEntry;
  } catch {
    return null;
  }
  if (parsed.source !== BROWSER_SOURCE || !parsed.expiresAt) return null;
  if (Date.parse(parsed.expiresAt) <= now.getTime()) return null;
  return sanitizeBrowserResult(parsed) as BrowserCacheEntry & { expiresAt: string };
}

export function writeCache(file: string, result: BrowserResult, now: Date, today: string, currency: string | null): BrowserCacheEntry {
  const clean = sanitizeBrowserResult(result, currency);
  const entry: BrowserCacheEntry = {
    ...clean,
    expiresAt: new Date(now.getTime() + fareTtlMs(result.query.date, today)).toISOString(),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

export function selectCached(force: boolean, cached: BrowserResult | null, now: Date, today: string): BrowserResult | null {
  if (force || !cached) return null;
  return cacheIsFresh(cached, now, today) ? cached : null;
}

export function cacheIsFresh(entry: { retrievedAt: string; query: BrowserQuery }, now: Date, today: string): boolean {
  const retrieved = Date.parse(entry.retrievedAt);
  if (!Number.isFinite(retrieved)) return false;
  return now.getTime() < retrieved + fareTtlMs(entry.query.date, today);
}
