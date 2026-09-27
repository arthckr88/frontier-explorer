import { readFileSync, writeFileSync } from "node:fs";
import { buildNetwork, diagnostics, diffSnapshots, emptyChangeFile, mergeChanges, snapshotsFrom, type RouteChangeFile, type RouteSnapshotFile, type ScheduleInput } from "@/site/network";
import { scheduleToday } from "@/site/view";

const flightsPath = new URL("../../data/flights.json", import.meta.url);
const networkPath = new URL("../../data/network.json", import.meta.url);
const summaryPath = new URL("../../data/route-summaries.json", import.meta.url);
const changePath = new URL("../../data/route-changes.json", import.meta.url);
const diagnosticPath = new URL("../../data/diagnostics.json", import.meta.url);

const schedule = JSON.parse(readFileSync(flightsPath, "utf8")) as ScheduleInput;
const today = scheduleToday();
const network = buildNetwork(schedule, today);
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
