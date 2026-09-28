import { readFileSync, writeFileSync } from "node:fs";
import { attachBrowserFares, loadBrowserFareText } from "@/site/browser/integrate";
import type { OfficialCatalogue } from "@/site/direct-routes";
import { buildNetwork, diagnostics, diffSnapshots, emptyChangeFile, mergeChanges, snapshotsFrom, type OfficialNetwork, type RouteChangeFile, type RouteSnapshotFile, type ScheduleInput } from "@/site/network";
import { scheduleToday } from "@/site/view";

const flightsPath = new URL("../../data/flights.json", import.meta.url);
const networkPath = new URL("../../data/network.json", import.meta.url);
const summaryPath = new URL("../../data/route-summaries.json", import.meta.url);
const changePath = new URL("../../data/route-changes.json", import.meta.url);
const diagnosticPath = new URL("../../data/diagnostics.json", import.meta.url);

const stored = JSON.parse(readFileSync(flightsPath, "utf8")) as ScheduleInput;
const fares = loadBrowserFareText(new URL("../../data/browser-fares.json", import.meta.url));
const schedule = attachBrowserFares(stored, fares);
const today = scheduleToday();
const network = buildNetwork(schedule, today, officialNetwork(fares));
const previous = readJson<RouteSnapshotFile>(summaryPath);
const incoming = diffSnapshots(previous, snapshotsFrom(network.observations, network.checks), today);
const changes = mergeChanges(readJson<RouteChangeFile>(changePath)?.events ?? emptyChangeFile().events, incoming, today);
const changeFile: RouteChangeFile = { windowDays: 90, events: changes };
const report = diagnostics(schedule, network);

writeIfChanged(networkPath, network);
writeIfChanged(summaryPath, snapshotsFrom(network.observations, network.checks));
writeIfChanged(changePath, changeFile);
writeIfChanged(diagnosticPath, report);
console.log(JSON.stringify(report, null, 2));

function officialNetwork(fares: { retrievedAt?: string }[]): OfficialNetwork {
  const catalogue = JSON.parse(readFileSync(new URL("../../data/frontier-direct-routes.json", import.meta.url), "utf8")) as OfficialCatalogue;
  let candidateMarkets = 0;
  try {
    const markets = JSON.parse(readFileSync(new URL("../../data/frontier-markets.json", import.meta.url), "utf8")) as { markets?: unknown[] };
    candidateMarkets = markets.markets?.length ?? 0;
  } catch {
    candidateMarkets = 0;
  }
  const lastBrowserCollection = fares.map((fare) => fare.retrievedAt ?? "").filter(Boolean).sort().at(-1) ?? null;
  return {
    retrievedAt: catalogue.retrievedAt,
    source: "Frontier official direct routes",
    sourceUrl: catalogue.sourceUrl,
    airports: catalogue.airports.map((airport) => airport.iata),
    routes: catalogue.routes,
    unresolved: catalogue.unresolved,
    candidateMarkets,
    lastBrowserCollection,
  };
}

function readJson<T>(url: URL): T | null {
  try {
    return JSON.parse(readFileSync(url, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeIfChanged(url: URL, value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (readFileSync(url, "utf8") === text) return;
  } catch {
    // The file is created on the first normalize.
  }
  writeFileSync(url, text);
}
