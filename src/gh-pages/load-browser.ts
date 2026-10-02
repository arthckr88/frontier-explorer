import type { BrowserFareRecord, NetworkArtifact, RouteChangeFile } from "@/site/network";
import type { AirportRecord, HistoricalMetrics, PriceHistoryRow, StaticCatalog, AirportDeparture } from "@/static/types";

export async function loadCatalogBrowser(): Promise<StaticCatalog> {
  const version = new URL(import.meta.url).searchParams.get("v");
  const dataUrl = (name: string) => version ? `${name}?v=${encodeURIComponent(version)}` : name;
  const [network, fareFile, changes, historyText, airports, historical, airportDepartures] = await Promise.all([
    fetch(dataUrl("network.json")).then((response) => response.json() as Promise<NetworkArtifact>),
    fetch(dataUrl("browser-fares.json")).then((response) => response.json() as Promise<{ fares?: BrowserFareRecord[] }>),
    fetch(dataUrl("route-changes.json")).then((response) => response.json() as Promise<RouteChangeFile>),
    fetch(dataUrl("price-history.jsonl")).then((response) => response.text()),
    fetch(dataUrl("airports.json")).then((response) => response.json() as Promise<AirportRecord[]>),
    fetch(dataUrl("historical-metrics.json")).then((response) => (response.ok ? (response.json() as Promise<HistoricalMetrics>) : null)),
    fetch(dataUrl("airport-departures.json")).then((response) => response.json() as Promise<AirportDeparture[]>),
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
    historical,
    airportDepartures,
  };
}
