import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cachePath, readFreshCache } from "@/site/browser/cache";
import { classifyBookingPage } from "@/site/browser/parse";
import { captureBookingPage } from "@/site/browser/playwright-search";
import type { OfficialCatalogue } from "@/site/direct-routes";

export const VERIFY_PAUSE_MS = 15_000;
const FRESH_MS = 12 * 60 * 60 * 1000;

export type VerifyStatus = "ok" | "no_flights" | "blocked" | "parse_error" | "navigation_error" | "unchecked";

export type VerifyRecord = {
  origin: string;
  destination: string;
  date: string;
  status: VerifyStatus;
  retrievedAt: string | null;
};

export type VerifyRoute = { origin: string; destination: string };

export type VerifyOptions = {
  date: string;
  limit: number;
  origin?: string;
  region?: string;
  officialOnly: boolean;
  uncheckedOnly: boolean;
  now?: string;
  freshMs?: number;
};

export function selectVerificationTargets(
  routes: VerifyRoute[],
  records: VerifyRecord[],
  regions: Map<string, string>,
  options: VerifyOptions,
): VerifyRoute[] {
  const now = Date.parse(options.now ?? new Date().toISOString());
  const freshMs = options.freshMs ?? FRESH_MS;
  const chosen: VerifyRoute[] = [];
  for (const route of routes) {
    if (options.origin && route.origin !== options.origin.toUpperCase()) continue;
    if (options.region && regions.get(route.origin) !== options.region) continue;
    const record = records.find((item) => item.origin === route.origin && item.destination === route.destination && item.date === options.date);
    if (record && isFresh(record, now, freshMs)) continue;
    if (options.uncheckedOnly && record && record.status !== "unchecked") continue;
    chosen.push(route);
    if (chosen.length >= options.limit) break;
  }
  return chosen;
}

export function classifyProbe(result: { httpStatus?: number; flights?: number; error?: string | null }): { status: VerifyStatus; stop: boolean } {
  const error = (result.error ?? "").toLowerCase();
  const status = result.httpStatus ?? 0;
  if (status === 403 || status === 406 || /challenge|perimeterx|captcha|unexpected auth|login required/.test(error)) {
    return { status: "blocked", stop: true };
  }
  if (/parse/.test(error)) return { status: "parse_error", stop: false };
  if (/navigation|timeout|net::/.test(error)) return { status: "navigation_error", stop: false };
  if ((result.flights ?? 0) > 0) return { status: "ok", stop: false };
  return { status: "no_flights", stop: false };
}

export function parseVerifyArgs(argv: string[]): VerifyOptions {
  const limit = Number(valueAfter(argv, "--limit") ?? "0");
  const date = valueAfter(argv, "--date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pass --date YYYY-MM-DD.");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Pass --limit with at least 1. This command does not verify the whole network at once.");
  return {
    date,
    limit,
    origin: valueAfter(argv, "--origin")?.toUpperCase(),
    region: valueAfter(argv, "--region") ?? undefined,
    officialOnly: argv.includes("--official-only") || true,
    uncheckedOnly: argv.includes("--unchecked-only"),
  };
}

function isFresh(record: VerifyRecord, now: number, freshMs: number) {
  if (!record.retrievedAt || record.status === "unchecked") return false;
  const retrieved = Date.parse(record.retrievedAt);
  return Number.isFinite(retrieved) && now - retrieved < freshMs;
}

function valueAfter(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

async function main() {
  const options = parseVerifyArgs(process.argv.slice(2));
  const catalogue = JSON.parse(readFileSync(new URL("../../data/frontier-direct-routes.json", import.meta.url), "utf8")) as OfficialCatalogue;
  const airports = JSON.parse(readFileSync(new URL("../../data/airports.json", import.meta.url), "utf8")) as { iata: string; region: string }[];
  const regions = new Map(airports.map((airport) => [airport.iata, airport.region]));
  const statePath = new URL("../../data/network-verification.json", import.meta.url);
  const records = readRecords(statePath);
  const targets = selectVerificationTargets(catalogue.routes, records, regions, options);
  console.log(JSON.stringify({ date: options.date, selected: targets, pauseMs: VERIFY_PAUSE_MS, remainingUnchecked: catalogue.routes.length - records.filter((record) => record.date === options.date && record.status !== "unchecked").length }));
  if (targets.length === 0) return;
  const cacheRoot = fileURLToPath(new URL("../../data/frontier-browser-cache/", import.meta.url));
  for (const target of targets) {
    const query = { origin: target.origin, destination: target.destination, date: options.date };
    const cached = readFreshCache(cachePath(cacheRoot, query), new Date());
    if (cached) {
      const status = cached.status;
      const next = { ...query, status, retrievedAt: cached.retrievedAt };
      const without = records.filter((record) => !(record.origin === query.origin && record.destination === query.destination && record.date === query.date));
      records.splice(0, records.length, ...without, next);
      writeFileSync(statePath, `${JSON.stringify(records, null, 2)}\n`);
      console.log(JSON.stringify({ ...next, cache: "fresh" }));
      if (status === "blocked") {
        console.error("Stopped. The next run resumes at the next unchecked official direct.");
        process.exitCode = 2;
        return;
      }
      continue;
    }
    let outcome: { status: VerifyStatus; stop: boolean };
    try {
      const captured = await captureBookingPage(query);
      const classified = classifyBookingPage(captured, query, new Date().toISOString());
      outcome = classified.status === "blocked" ? { status: "blocked", stop: true } : { status: classified.status, stop: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = classifyProbe({ error: message, flights: 0 });
    }
    const next: VerifyRecord = { ...target, date: options.date, status: outcome.status, retrievedAt: new Date().toISOString() };
    const without = records.filter((record) => !(record.origin === next.origin && record.destination === next.destination && record.date === next.date));
    records.splice(0, records.length, ...without, next);
    writeFileSync(statePath, `${JSON.stringify(records, null, 2)}\n`);
    console.log(JSON.stringify(next));
    if (outcome.stop) {
      console.error("Stopped. The next run resumes at the next unchecked official direct.");
      process.exitCode = 2;
      return;
    }
    if (target !== targets[targets.length - 1]) await new Promise((resolve) => setTimeout(resolve, VERIFY_PAUSE_MS));
  }
}

function readRecords(url: URL): VerifyRecord[] {
  try {
    return JSON.parse(readFileSync(url, "utf8")) as VerifyRecord[];
  } catch {
    return [];
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
