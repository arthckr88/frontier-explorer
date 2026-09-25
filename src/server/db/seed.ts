import { eq, sql } from "drizzle-orm";
import airportData from "../../../data/airports.json";
import { loadEnvFile } from "@/lib/env";
import { closeDb, getDb } from "@/server/db/client";
import { airports, metroAreas, savedRoutes, savedSearches, sources, userPreferences } from "@/server/db/schema";
import {
  defaultPreferences,
  historicalFrequentSeeds,
  metroSeeds,
  savedRouteSeeds,
  sourceSeeds,
} from "@/server/preferences/defaults";

loadEnvFile();

type AirportSeed = {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string;
  region: string;
};

async function main() {
const database = getDb();
if (!database) throw new Error("DATABASE_URL is not set.");

const rows = airportData as AirportSeed[];
for (let index = 0; index < rows.length; index += 400) {
  const batch = rows.slice(index, index + 400).map((airport) => ({
    iata: airport.iata,
    icao: airport.icao,
    name: airport.name,
    city: airport.city,
    country: airport.country,
    latitude: airport.lat,
    longitude: airport.lon,
    timezone: airport.timezone,
    region: airport.region,
  }));
  await database.insert(airports).values(batch).onConflictDoUpdate({
    target: airports.iata,
    set: {
      icao: sql`excluded.icao`,
      name: sql`excluded.name`,
      city: sql`excluded.city`,
      country: sql`excluded.country`,
      latitude: sql`excluded.latitude`,
      longitude: sql`excluded.longitude`,
      timezone: sql`excluded.timezone`,
      region: sql`excluded.region`,
    },
  });
}

for (const metro of metroSeeds) {
  await database
    .insert(metroAreas)
    .values({
      code: metro.code,
      name: metro.name,
      primaryAirports: [...metro.primaryAirports],
      nearbyAirports: [...metro.nearbyAirports],
    })
    .onConflictDoUpdate({
      target: metroAreas.code,
      set: {
        name: metro.name,
        primaryAirports: [...metro.primaryAirports],
        nearbyAirports: [...metro.nearbyAirports],
      },
    });
  for (const iata of [...metro.primaryAirports, ...metro.nearbyAirports]) {
    await database.update(airports).set({ metroCode: metro.code }).where(eq(airports.iata, iata));
  }
}

for (const source of sourceSeeds) {
  await database
    .insert(sources)
    .values({
      id: source.id,
      name: source.name,
      tier: source.tier,
      kind: source.kind,
      baseUrl: source.baseUrl,
    })
    .onConflictDoUpdate({
      target: sources.id,
      set: { name: source.name, tier: source.tier, kind: source.kind, baseUrl: source.baseUrl },
    });
}

await database
  .insert(userPreferences)
  .values({ id: "default", payload: defaultPreferences, updatedAt: new Date() })
  .onConflictDoNothing();

for (const route of [...savedRouteSeeds, ...historicalFrequentSeeds.map((route) => ({ ...route, watched: false, note: "Historical frequent route from personal preferences. Not evidence the flight currently operates." }))]) {
  await database.insert(savedRoutes).values({
    originIata: route.origin,
    destinationIata: route.destination,
    label: route.label,
    watched: route.watched,
    note: route.note,
  }).onConflictDoNothing();
}

await database
  .insert(savedSearches)
  .values([
    {
      id: "bay-la",
      name: "Bay Area ↔ Los Angeles",
      payload: {
        origins: ["OAK", "SFO"],
        destinations: ["LAX", "BUR"],
        nearbyOrigins: ["SJC"],
        nearbyDestinations: ["SNA", "ONT"],
      },
    },
    {
      id: "bay-ny",
      name: "Bay Area → New York",
      payload: {
        origins: ["OAK", "SFO"],
        destinations: ["LGA", "JFK"],
        nearbyOrigins: ["SJC"],
        nearbyDestinations: ["EWR"],
      },
    },
    {
      id: "florida",
      name: "Florida",
      payload: { destinations: ["MCO", "FLL", "MIA"], primary: "MCO" },
    },
  ])
  .onConflictDoNothing();

await closeDb();
console.log(`Seeded ${rows.length} reference airports, preferences, and empty route network.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
