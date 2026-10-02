import { readFileSync, writeFileSync } from "node:fs";
import { PDX_FLIGHTS_URL, PDX_ROUTES_URL, parsePdxDepartures, parsePdxRoutes } from "@/site/airport-sources";
import type { OfficialRoute } from "@/site/direct-routes";
import type { AirportDeparture } from "@/static/types";

// Public airport pages only. No login, cookies, private endpoints, or paid feed.
void refresh().catch((error) => { console.error(error); process.exitCode = 1; });

async function refresh() {
  const retrievedAt = new Date().toISOString();
  const [routeHtml, flightHtml] = await Promise.all([readPublicPage(PDX_ROUTES_URL), readPublicPage(PDX_FLIGHTS_URL)]);
  const routes = parsePdxRoutes(routeHtml, retrievedAt);
  const departures = parsePdxDepartures(flightHtml, routes, retrievedAt);
  const routesPath = new URL("../../data/verified-direct-routes.json", import.meta.url);
  const departuresPath = new URL("../../data/airport-departures.json", import.meta.url);
  const existing = JSON.parse(readFileSync(routesPath, "utf8")) as OfficialRoute[];
  const previous = JSON.parse(readFileSync(departuresPath, "utf8")) as AirportDeparture[];
  // Validate both pages before replacing this provider's snapshot.
  writeFileSync(routesPath, `${JSON.stringify([...existing.filter((route) => route.nonstopEvidence?.sourceUrl !== PDX_ROUTES_URL), ...routes], null, 2)}\n`);
  writeFileSync(departuresPath, `${JSON.stringify([...previous.filter((flight) => flight.sourceUrl !== PDX_FLIGHTS_URL), ...departures], null, 2)}\n`);
  console.log(JSON.stringify({ source: "Portland International Airport", retrievedAt, routes: routes.length, departures: departures.length }));
}

async function readPublicPage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Airport source HTTP ${response.status}. Existing data was preserved.`);
  return response.text();
}
