import { readFileSync, writeFileSync } from "node:fs";
import { DateTime } from "luxon";
import airportData from "../../data/airports.json";
import { loadEnvFile } from "@/lib/env";
import { fetchPublicScheduleDay } from "@/server/ingestion/sources/public-schedule";
import type { PublishedFlight, PublishedSchedule } from "@/site/published-search";

const FILE = new URL("../../data/flights.json", import.meta.url);
const ZONES = new Map((airportData as { iata: string; timezone: string }[]).map((airport) => [airport.iata, airport.timezone]));

loadEnvFile();

async function main() {
  const schedule = readSchedule();
  const pairs = uniquePairs(schedule.flights);
  if (pairs.length === 0) {
    console.log("No published city pairs to widen.");
    return;
  }
  const latest = schedule.flights.map((flight) => flight.date).sort().at(-1);
  if (!latest) return;
  const target = addDays(latest, 1);
  if (!target) return;
  const checked = new Set(schedule.checked);
  const blocked = new Set(schedule.blocked);
  const legs = pairs.filter((pair) => {
    const key = `${pair.origin}|${pair.destination}|${target}`;
    return !checked.has(key) && !blocked.has(key);
  });
  console.log(`Widening ${legs.length} published pairs to ${target} with concurrency ${concurrency()}.`);
  await mapPool(legs, concurrency(), async (pair) => {
    const key = `${pair.origin}|${pair.destination}|${target}`;
    const result = await fetchPublicScheduleDay(pair.origin, pair.destination, target);
    if (!result.ok) {
      if (result.blocked) {
        blocked.add(key);
        console.log(`HTTP 406, skipped ${key}`);
      } else {
        console.log(`Left ${key} unchecked: ${result.detail}`);
      }
      return;
    }
    checked.add(key);
    for (const flight of result.flights) {
      const published = publishFlight(flight);
      if (!published) {
        console.log(`Skipped ${flight.origin}-${flight.destination} ${flight.flightNumber} with no airport timezone.`);
        continue;
      }
      if (!schedule.flights.some((existing) => sameFlight(existing, published))) schedule.flights.push(published);
      markScheduled(schedule, published.origin, published.destination);
    }
    console.log(`${key}: ${result.flights.length} flight${result.flights.length === 1 ? "" : "s"}`);
  });
  schedule.checked = [...checked].sort();
  schedule.blocked = [...blocked].sort();
  schedule.flights.sort(compareFlights);
  writeFileSync(FILE, `${JSON.stringify(schedule, null, 2)}\n`);
}

function readSchedule(): PublishedSchedule {
  const parsed = JSON.parse(readFileSync(FILE, "utf8")) as PublishedSchedule;
  parsed.flights ??= [];
  parsed.checked ??= [];
  parsed.blocked ??= [];
  return parsed;
}

function markScheduled(schedule: PublishedSchedule, origin: string, destination: string) {
  schedule.routes ??= [];
  const route = schedule.routes.find((item) => item.origin === origin && item.destination === destination);
  if (route) route.provenance = "scheduled";
  else schedule.routes.push({ origin, destination, provenance: "scheduled" });
}

function uniquePairs(flights: PublishedFlight[]) {
  const seen = new Set<string>();
  const pairs: { origin: string; destination: string }[] = [];
  for (const flight of flights) {
    const key = `${flight.origin}|${flight.destination}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ origin: flight.origin, destination: flight.destination });
  }
  return pairs;
}

function publishFlight(flight: {
  origin: string;
  destination: string;
  flightNumber: string;
  date: string;
  departureLocal: string;
  arrivalLocal: string;
}): PublishedFlight | null {
  const departureUtc = toUtc(flight.departureLocal, flight.origin);
  const arrivalUtc = toUtc(flight.arrivalLocal, flight.destination);
  if (!departureUtc || !arrivalUtc) return null;
  return { ...flight, departureUtc, arrivalUtc };
}

function toUtc(local: string, iata: string): string | null {
  const zone = ZONES.get(iata);
  if (!zone) return null;
  const value = DateTime.fromISO(local, { zone });
  if (!value.isValid) return null;
  return value.toUTC().toISO({ suppressMilliseconds: true });
}

function sameFlight(left: PublishedFlight, right: PublishedFlight) {
  return (
    left.origin === right.origin &&
    left.destination === right.destination &&
    left.date === right.date &&
    left.flightNumber === right.flightNumber &&
    left.departureLocal === right.departureLocal
  );
}

function compareFlights(left: PublishedFlight, right: PublishedFlight) {
  return (
    left.date.localeCompare(right.date) ||
    left.origin.localeCompare(right.origin) ||
    left.destination.localeCompare(right.destination) ||
    left.departureLocal.localeCompare(right.departureLocal)
  );
}

function concurrency() {
  const value = Number(process.env.PUBLIC_SCHEDULE_CONCURRENCY ?? 4);
  if (!Number.isFinite(value)) return 4;
  return Math.min(8, Math.max(1, Math.round(value)));
}

function addDays(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function mapPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  if (items.length === 0) return;
  let index = 0;
  async function worker() {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      const item = items[current];
      if (item === undefined) return;
      await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
