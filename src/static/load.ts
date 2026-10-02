import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserFareRecord, NetworkArtifact, RouteChangeFile } from "@/site/network";
import type { AirportRecord, HistoricalMetrics, PriceHistoryRow, StaticCatalog } from "@/static/types";

function readDataFile(name: string) {
  return readFileSync(path.join(process.cwd(), "data", name), "utf8");
}

let cached: StaticCatalog | null = null;

export function loadCatalog(): StaticCatalog {
  if (cached) return cached;
  const network = JSON.parse(readDataFile("network.json")) as NetworkArtifact;
  const fareFile = JSON.parse(readDataFile("browser-fares.json")) as {
    fares?: BrowserFareRecord[];
  };
  const changes = JSON.parse(readDataFile("route-changes.json")) as RouteChangeFile;
  const fares = fareFile.fares ?? network.fares ?? [];
  const airports = JSON.parse(readDataFile("airports.json")) as AirportRecord[];
  const priceHistory = readDataFile("price-history.jsonl")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PriceHistoryRow);
  const historical = readHistorical();
  const codes = referencedCodes(network, fares, changes);
  for (const code of network.official?.airports ?? []) codes.add(code);
  for (const route of network.official?.routes ?? []) {
    codes.add(route.origin);
    codes.add(route.destination);
  }
  cached = {
    network,
    fares,
    changes,
    priceHistory,
    airports: airports.filter((airport) => codes.has(airport.iata)),
    historical,
    airportDepartures: JSON.parse(readDataFile("airport-departures.json")),
  };
  return cached;
}

function readHistorical(): HistoricalMetrics | null {
  try {
    return JSON.parse(readDataFile("historical-metrics.json")) as HistoricalMetrics;
  } catch {
    return null;
  }
}

function referencedCodes(network: NetworkArtifact, fares: BrowserFareRecord[], changes: RouteChangeFile) {
  const codes = new Set<string>();
  for (const flight of network.observations) {
    codes.add(flight.origin);
    codes.add(flight.destination);
  }
  for (const check of network.checks ?? []) {
    codes.add(check.origin);
    codes.add(check.destination);
  }
  for (const summary of network.summaries ?? []) {
    codes.add(summary.origin);
    codes.add(summary.destination);
  }
  for (const fare of fares) {
    codes.add(fare.origin);
    codes.add(fare.destination);
  }
  for (const event of changes.events) {
    codes.add(event.origin);
    codes.add(event.destination);
  }
  return codes;
}
