import { writeFileSync } from "node:fs";
import { DateTime } from "luxon";
import { loadEnvFile } from "@/lib/env";
import { getDb, closeDb } from "@/server/db/client";
import { airports, flightInstances } from "@/server/db/schema";
import type { PublishedFlight, PublishedSchedule } from "@/site/published-search";

loadEnvFile();

async function main() {
  const database = getDb();
  if (!database) throw new Error("DATABASE_URL is not set.");
  const zones = new Map(
    (await database.select({ iata: airports.iata, timezone: airports.timezone }).from(airports)).map((airport) => [
      airport.iata,
      airport.timezone,
    ]),
  );
  const rows = await database
    .select({
      origin: flightInstances.originIata,
      destination: flightInstances.destinationIata,
      flightNumber: flightInstances.flightNumber,
      date: flightInstances.operatingDate,
      departureLocal: flightInstances.departureLocal,
      arrivalLocal: flightInstances.arrivalLocal,
    })
    .from(flightInstances);
  const flights: PublishedFlight[] = [];
  const checked = new Set<string>();
  for (const row of rows) {
    const originZone = zones.get(row.origin);
    const destinationZone = zones.get(row.destination);
    if (!row.flightNumber || !row.departureLocal || !row.arrivalLocal || !originZone || !destinationZone) continue;
    const departureUtc = DateTime.fromISO(row.departureLocal, { zone: originZone }).toUTC().toISO({ suppressMilliseconds: true });
    const arrivalUtc = DateTime.fromISO(row.arrivalLocal, { zone: destinationZone }).toUTC().toISO({ suppressMilliseconds: true });
    if (!departureUtc || !arrivalUtc) continue;
    flights.push({
      origin: row.origin,
      destination: row.destination,
      flightNumber: row.flightNumber,
      date: row.date,
      departureLocal: row.departureLocal,
      arrivalLocal: row.arrivalLocal,
      departureUtc,
      arrivalUtc,
    });
    checked.add(`${row.origin}|${row.destination}|${row.date}`);
  }
  flights.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.origin.localeCompare(right.origin) ||
      left.destination.localeCompare(right.destination) ||
      left.departureLocal.localeCompare(right.departureLocal),
  );
  const schedule: PublishedSchedule = { flights, checked: [...checked].sort(), blocked: [] };
  writeFileSync(new URL("../data/flights.json", import.meta.url), `${JSON.stringify(schedule, null, 2)}\n`);
  console.log(`Wrote ${flights.length} flights, ${checked.size} checked days.`);
  await closeDb();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
