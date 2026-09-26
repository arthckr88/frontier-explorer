import { readFileSync, writeFileSync } from "node:fs";
import { DateTime } from "luxon";
import airportData from "../../data/airports.json";
import { loadEnvFile } from "@/lib/env";
import { fetchPublicScheduleDay } from "@/server/ingestion/sources/public-schedule";
import type { PublishedFlight, PublishedSchedule } from "@/site/published-search";

const FILE = new URL("../../data/flights.json", import.meta.url);
const NYC = ["JFK", "LGA", "EWR"];
const ZONES = new Map((airportData as { iata: string; timezone: string }[]).map((airport) => [airport.iata, airport.timezone]));

loadEnvFile();

async function main() {
  const schedule = readSchedule();
  const listed = new Set((schedule.routes ?? []).map((route) => `${route.origin}|${route.destination}`));
  const hubs = new Set<string>(["SFO", "OAK", "LAS", "DEN", "ATL", "DFW", "LAX"]);
  for (const flight of schedule.flights) {
    hubs.add(flight.origin);
    hubs.add(flight.destination);
  }
  const dates = dateWindow(process.env.NYC_SCHEDULE_START ?? DateTime.now().toISODate() ?? "2026-09-26", 14);
  const tasks: { origin: string; destination: string; date: string }[] = [];
  const checked = new Set(schedule.checked);
  const blocked = new Set(schedule.blocked);
  const skippedPairs = new Set<string>();
  for (const origin of hubs) {
    for (const destination of NYC) {
      const pair = `${origin}|${destination}`;
      if (!listed.has(pair) && !["SFO", "OAK", "LAS"].includes(origin)) continue;
      if (!listed.has(pair)) continue;
      if ([...blocked].some((key) => key.startsWith(`${pair}|`))) {
        skippedPairs.add(pair);
        continue;
      }
      for (const date of dates) {
        const key = `${pair}|${date}`;
        if (checked.has(key) || blocked.has(key)) continue;
        tasks.push({ origin, destination, date });
      }
    }
  }
  console.log(`Fetching ${tasks.length} West Coast and hub days to JFK, LGA, and EWR. Concurrency 4.`);
  let added = 0;
  await mapPool(tasks, 4, async (task) => {
    const pair = `${task.origin}|${task.destination}`;
    const key = `${pair}|${task.date}`;
    if (skippedPairs.has(pair) || blocked.has(key) || checked.has(key)) return;
    const result = await fetchPublicScheduleDay(task.origin, task.destination, task.date);
    if (!result.ok) {
      if (result.blocked) {
        blocked.add(key);
        skippedPairs.add(pair);
        console.log(`HTTP 406, skipped ${pair}`);
      } else {
        console.log(`Left ${key} unchecked: ${result.detail}`);
      }
      return;
    }
    checked.add(key);
    let count = 0;
    for (const flight of result.flights) {
      if (flight.origin !== task.origin || flight.destination !== task.destination) continue;
      const published = publishFlight(flight);
      if (!published) continue;
      if (!schedule.flights.some((existing) => sameFlight(existing, published))) {
        schedule.flights.push(published);
        added += 1;
        count += 1;
      }
      markScheduled(schedule, published.origin, published.destination);
    }
    console.log(`${key}: ${count} new flight${count === 1 ? "" : "s"}`);
  });
  schedule.checked = [...checked].sort();
  schedule.blocked = [...blocked].sort();
  schedule.flights.sort(compareFlights);
  writeFileSync(FILE, `${JSON.stringify(schedule, null, 2)}\n`);
  console.log(`Done. Added ${added} flights.`);
}

function readSchedule(): PublishedSchedule {
  const parsed = JSON.parse(readFileSync(FILE, "utf8")) as PublishedSchedule;
  parsed.flights ??= [];
  parsed.routes ??= [];
  parsed.checked ??= [];
  parsed.blocked ??= [];
  return parsed;
}

function dateWindow(start: string, days: number) {
  const first = DateTime.fromISO(start).startOf("day");
  return Array.from({ length: days }, (_, index) => first.plus({ days: index }).toISODate()).filter((date): date is string => Boolean(date));
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

function markScheduled(schedule: PublishedSchedule, origin: string, destination: string) {
  schedule.routes ??= [];
  const route = schedule.routes.find((item) => item.origin === origin && item.destination === destination);
  if (route) route.provenance = "scheduled";
  else schedule.routes.push({ origin, destination, provenance: "scheduled" });
}

function sameFlight(left: PublishedFlight, right: PublishedFlight) {
  return left.origin === right.origin && left.destination === right.destination && left.date === right.date && left.flightNumber === right.flightNumber && left.departureLocal === right.departureLocal;
}

function compareFlights(left: PublishedFlight, right: PublishedFlight) {
  return left.date.localeCompare(right.date) || left.origin.localeCompare(right.origin) || left.destination.localeCompare(right.destination) || left.departureLocal.localeCompare(right.departureLocal);
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
