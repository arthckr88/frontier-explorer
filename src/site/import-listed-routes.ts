import { readFileSync, writeFileSync } from "node:fs";
import { parseBookingMarkets } from "@/server/ingestion/parse/public-schedule";
import type { PublishedRoute, PublishedSchedule } from "@/site/published-search";

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error("Pass the booking homepage HTML path.");
  process.exit(1);
}

const FILE = new URL("../../data/flights.json", import.meta.url);
const schedule = JSON.parse(readFileSync(FILE, "utf8")) as PublishedSchedule;
schedule.flights ??= [];
schedule.checked ??= [];
schedule.blocked ??= [];

const markets = parseBookingMarkets(readFileSync(htmlPath, "utf8"));
const scheduled = new Set(schedule.flights.map((flight) => `${flight.origin}|${flight.destination}`));
const routes: PublishedRoute[] = [];
const seen = new Set<string>();

for (const [origin, destinations] of markets) {
  for (const destination of destinations) {
    if (origin === destination) continue;
    const key = `${origin}|${destination}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ origin, destination, provenance: scheduled.has(key) ? "scheduled" : "listed" });
  }
}

for (const key of scheduled) {
  if (seen.has(key)) continue;
  const [origin, destination] = key.split("|");
  if (!origin || !destination) continue;
  routes.push({ origin, destination, provenance: "scheduled" });
}

routes.sort((left, right) => left.origin.localeCompare(right.origin) || left.destination.localeCompare(right.destination));
schedule.routes = routes;
writeFileSync(FILE, `${JSON.stringify(schedule, null, 2)}\n`);

const listed = routes.filter((route) => route.provenance === "listed").length;
const timed = routes.filter((route) => route.provenance === "scheduled").length;
console.log(`routes ${routes.length} listed ${listed} scheduled ${timed} markets ${markets.size}`);
