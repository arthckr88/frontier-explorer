import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DateTime } from "luxon";
import { cachePath, readFreshCache, selectCached, writeCache } from "@/site/browser/cache";
import { parseBrowserArgs } from "@/site/browser/form";
import { appendPriceHistory, priceObservationsFrom } from "@/site/browser/history";
import { mergeBrowserNonstops, readBrowserFareFile, upsertFareResults, type BrowserFareFile } from "@/site/browser/integrate";
import type { ScheduleInput } from "@/site/network";
import { classifyBookingPage } from "@/site/browser/parse";
import { captureBookingPage } from "@/site/browser/playwright-search";
import { runBrowserQueue } from "@/site/browser/queue";
import { sanitizeBrowserResult } from "@/site/browser/sanitize";
import { scheduleToday } from "@/site/time";
import { SEARCH_PAUSE_MS, type BrowserQuery, type BrowserResult } from "@/site/browser/types";

const CACHE_ROOT = new URL("../../../data/frontier-browser-cache/", import.meta.url);

function main() {
  const args = parseBrowserArgs(process.argv.slice(2));
  const today = scheduleToday(DateTime.now());
  const run = (query: BrowserQuery) => collectOne(query, today, args.force);
  const pending = args.queue ? runBrowserQueue(args.queries, run, undefined, SEARCH_PAUSE_MS) : run(args.queries[0] as BrowserQuery).then((result) => [result]);
  pending
    .then((results) => {
      for (const result of results) console.log(JSON.stringify(result));
      if (results.some((result) => result.status === "blocked")) process.exit(2);
      if (results.some((result) => result.status === "parse_error" || result.status === "navigation_error")) process.exit(1);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Frontier browser search failed.";
      console.error(message.includes("navigation_error") ? "navigation_error" : message);
      process.exit(1);
    });
}

async function collectOne(query: BrowserQuery, today: string, force: boolean): Promise<BrowserResult> {
  const file = cachePath(fileURLToPath(CACHE_ROOT), query);
  const now = new Date();
  if (!force) {
    const cached = selectCached(false, readFreshCache(file, now), now, today);
    if (cached) return cached;
  }
  const captured = await captureBookingPage(query, now);
  const classified = classifyBookingPage(captured, query, now.toISOString());
  const currency = classified.status === "ok" ? "USD" : null;
  const stored = writeCache(file, classified, now, today, currency);
  if (captured.meta.markets) {
    mkdirSync(fileURLToPath(CACHE_ROOT), { recursive: true });
    writeFileSync(new URL(`markets-${query.origin}.json`, CACHE_ROOT), `${JSON.stringify(captured.meta.markets, null, 2)}\n`);
  }
  const clean = sanitizeBrowserResult(stored, currency);
  rememberResult(clean);
  return clean;
}

function rememberResult(result: BrowserResult) {
  const fareFile = new URL("../../../data/browser-fares.json", import.meta.url);
  const flightsFile = new URL("../../../data/flights.json", import.meta.url);
  let existing: BrowserFareFile["fares"] = [];
  try {
    existing = readBrowserFareFile(readFileSync(fareFile, "utf8"));
  } catch {
    existing = [];
  }
  const fares = upsertFareResults(existing, result);
  writeFileSync(fareFile, `${JSON.stringify({ source: "frontier_browser", fares }, null, 2)}\n`);
  const schedule = JSON.parse(readFileSync(flightsFile, "utf8")) as ScheduleInput;
  const merged = mergeBrowserNonstops(schedule, [result]);
  if ((merged.flights?.length ?? 0) !== (schedule.flights?.length ?? 0)) {
    writeFileSync(flightsFile, `${JSON.stringify(merged, null, 2)}\n`);
  }
  appendPriceHistory(fileURLToPath(new URL("../../../data/price-history.jsonl", import.meta.url)), priceObservationsFrom(result));
}

main();
