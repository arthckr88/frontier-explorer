import type { BrowserFareRecord, NetworkArtifact, RouteChangeFile } from "@/site/network";
import type { AirportRecord, PriceHistoryRow, StaticCatalog } from "@/static/types";

export async function loadCatalogBrowser(): Promise<StaticCatalog> {
  const [network, fareFile, changes, historyText, airports] = await Promise.all([
    fetch("network.json").then((response) => response.json() as Promise<NetworkArtifact>),
    fetch("browser-fares.json").then((response) => response.json() as Promise<{ fares?: BrowserFareRecord[] }>),
    fetch("route-changes.json").then((response) => response.json() as Promise<RouteChangeFile>),
    fetch("price-history.jsonl").then((response) => response.text()),
    fetch("airports.json").then((response) => response.json() as Promise<AirportRecord[]>),
  ]);
  const priceHistory = historyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PriceHistoryRow);
  return {
    network,
    fares: fareFile.fares ?? network.fares ?? [],
    changes,
    priceHistory,
    airports,
  };
}
