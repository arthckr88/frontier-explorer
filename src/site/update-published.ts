import { readFileSync, writeFileSync } from "node:fs";
import airportData from "../../data/airports.json";
import { loadEnvFile } from "@/lib/env";
import { fetchPublicScheduleDay } from "@/server/ingestion/sources/public-schedule";
import type { PublishedFlight, PublishedSchedule } from "@/site/published-search";
import { localToUtc } from "@/site/time";
import { applyDayResult, planScheduleChecks, type BlockMeta } from "@/site/update-plan";
import { scheduleToday } from "@/site/view";

const FILE = new URL("../../data/flights.json", import.meta.url);
const ZONES = new Map((airportData as { iata: string; timezone: string }[]).map((airport) => [airport.iata, airport.timezone]));

loadEnvFile();

type StoredSchedule = PublishedSchedule & {
  refreshedAt?: string | null;
  blockMeta?: Record<string, BlockMeta>;
  flights: Array<PublishedFlight & { retrievedAt?: string | null }>;
};

async function main() {
  const schedule = readSchedule();
  const today = scheduleToday();
  const plan = planScheduleChecks({
    today,
    flights: schedule.flights,
    checked: schedule.checked,
    blocked: schedule.blocked,
    blockMeta: schedule.blockMeta,
    routes: schedule.routes,
  });
  if (plan.length === 0) {
    console.log("No booking dates to check inside the rolling windows.");
    return;
  }
  console.log(`Checking ${plan.length} booking dates with concurrency ${concurrency()}. Priority corridors only. This is verification, not a full-network crawl.`);
  await mapPool(plan, concurrency(), async (request) => {
    await pause(250);
    const key = `${request.origin}|${request.destination}|${request.date}`;
    const result = await fetchPublicScheduleDay(request.origin, request.destination, request.date);
    if (!result.ok) {
      applyDayResult(schedule, request, { ok: false, blocked: result.blocked }, today, new Date().toISOString());
      console.log(result.blocked ? `HTTP 406, left ${key} blocked (unknown, not empty)` : `Left ${key} unchecked: ${result.detail}`);
      return;
    }
    const retrievedAt = new Date().toISOString();
    applyDayResult(
      schedule,
      request,
      { ok: true, flights: result.flights.map((flight) => ({ ...flight, departureLocal: flight.departureLocal })) },
      today,
      retrievedAt,
    );
    for (const flight of result.flights) {
      const published = publishFlight(flight, retrievedAt);
      if (!published) {
        console.log(`Skipped ${flight.origin}-${flight.destination} ${flight.flightNumber} with no airport timezone.`);
        continue;
      }
      if (!schedule.flights.some((existing) => sameFlight(existing, published))) schedule.flights.push(published);
      markScheduled(schedule, published.origin, published.destination);
    }
    console.log(`${key} ${request.reason}: ${result.flights.length} flight${result.flights.length === 1 ? "" : "s"}`);
  });
  schedule.checked = [...new Set(schedule.checked)].sort();
  schedule.blocked = [...new Set(schedule.blocked)].sort();
  schedule.flights.sort(compareFlights);
  writeFileSync(FILE, `${JSON.stringify(schedule, null, 2)}\n`);
}

function readSchedule(): StoredSchedule {
  const parsed = JSON.parse(readFileSync(FILE, "utf8")) as StoredSchedule;
  parsed.flights ??= [];
  parsed.checked ??= [];
  parsed.blocked ??= [];
  parsed.blockMeta ??= {};
  return parsed;
}

function markScheduled(schedule: PublishedSchedule, origin: string, destination: string) {
  schedule.routes ??= [];
  const route = schedule.routes.find((item) => item.origin === origin && item.destination === destination);
  if (route) route.provenance = "scheduled";
  else schedule.routes.push({ origin, destination, provenance: "scheduled" });
}

function publishFlight(
  flight: {
    origin: string;
    destination: string;
    flightNumber: string;
    date: string;
    departureLocal: string;
    arrivalLocal: string;
  },
  retrievedAt: string,
): (PublishedFlight & { retrievedAt: string }) | null {
  const departureUtc = localToUtc(flight.departureLocal, ZONES.get(flight.origin) ?? "");
  const arrivalUtc = localToUtc(flight.arrivalLocal, ZONES.get(flight.destination) ?? "");
  if (!departureUtc || !arrivalUtc) return null;
  return { ...flight, departureUtc, arrivalUtc, retrievedAt };
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
  return Math.min(4, Math.max(1, Math.round(value)));
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
