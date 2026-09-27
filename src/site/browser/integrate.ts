import { readFileSync } from "node:fs";
import type { BrowserFareRecord, ScheduleInput } from "@/site/network";
import { localToUtc, SCHEDULE_ZONE } from "@/site/time";
import { sanitizeBrowserResult } from "@/site/browser/sanitize";
import type { BrowserResult } from "@/site/browser/types";

export type BrowserFareFile = {
  source: "frontier_browser";
  fares: BrowserFareRecord[];
};

export function publishableFares(results: BrowserResult[]): BrowserFareRecord[] {
  const fares: BrowserFareRecord[] = [];
  for (const result of results) {
    const clean = sanitizeBrowserResult(result, "USD");
    if (clean.status !== "ok") continue;
    for (const flight of clean.flights) {
      fares.push({
        origin: flight.origin,
        destination: flight.destination,
        date: clean.query.date,
        carrier: flight.carrier,
        flightNumber: flight.flightNumber,
        departureLocal: flight.departureLocal,
        arrivalLocal: flight.arrivalLocal,
        durationMinutes: flight.durationMinutes,
        stops: flight.stops,
        standard: flight.fares.standard,
        discountDen: flight.fares.discountDen,
        goWild: flight.fares.goWild,
        seatsRemaining: flight.seatsRemaining,
        retrievedAt: clean.retrievedAt,
        source: "frontier_browser",
      });
    }
  }
  return fares.sort(compareFares);
}

export function mergeBrowserNonstops(schedule: ScheduleInput, results: BrowserResult[], zone = SCHEDULE_ZONE): ScheduleInput {
  const flights = [...(schedule.flights ?? [])];
  for (const result of results) {
    const clean = sanitizeBrowserResult(result);
    if (clean.status !== "ok") continue;
    for (const flight of clean.flights) {
      if (flight.stops !== 0) continue;
      const date = flight.departureLocal.slice(0, 10);
      const exists = flights.some(
        (item) =>
          item.origin === flight.origin &&
          item.destination === flight.destination &&
          item.flightNumber === flight.flightNumber &&
          item.departureLocal === flight.departureLocal,
      );
      if (exists) continue;
      const departureUtc = localToUtc(flight.departureLocal, zone);
      const arrivalUtc = localToUtc(flight.arrivalLocal, zone);
      if (!departureUtc || !arrivalUtc) continue;
      flights.push({
        origin: flight.origin,
        destination: flight.destination,
        flightNumber: flight.flightNumber,
        date,
        departureLocal: flight.departureLocal,
        arrivalLocal: flight.arrivalLocal,
        departureUtc,
        arrivalUtc,
        retrievedAt: clean.retrievedAt,
        provenance: "frontier_browser",
      });
    }
  }
  return { ...schedule, flights };
}

export function readBrowserFareFile(text: string): BrowserFareRecord[] {
  const parsed = JSON.parse(text) as BrowserFareFile;
  if (parsed.source !== "frontier_browser" || !Array.isArray(parsed.fares)) return [];
  return parsed.fares;
}

export function upsertFareResults(existing: BrowserFareRecord[], result: BrowserResult): BrowserFareRecord[] {
  const clean = sanitizeBrowserResult(result, "USD");
  if (clean.status === "blocked" || clean.status === "navigation_error" || clean.status === "parse_error") return existing;
  const key = `${clean.query.origin}|${clean.query.destination}|${clean.query.date}`;
  const kept = existing.filter((fare) => `${fare.origin}|${fare.destination}|${fare.date}` !== key);
  const added = clean.status === "ok" ? publishableFares([clean]) : [];
  return [...kept, ...added].sort(compareFares);
}

export function attachBrowserFares(schedule: ScheduleInput, fares: BrowserFareRecord[]): ScheduleInput {
  if (!fares.length) return schedule;
  return { ...schedule, browserFares: fares };
}

export function loadBrowserFareText(url: URL): BrowserFareRecord[] {
  try {
    return readBrowserFareFile(readFileSync(url, "utf8"));
  } catch {
    return [];
  }
}

function compareFares(left: BrowserFareRecord, right: BrowserFareRecord): number {
  return (
    left.origin.localeCompare(right.origin) ||
    left.destination.localeCompare(right.destination) ||
    left.date.localeCompare(right.date) ||
    left.departureLocal.localeCompare(right.departureLocal) ||
    left.flightNumber.localeCompare(right.flightNumber) ||
    left.arrivalLocal.localeCompare(right.arrivalLocal)
  );
}
