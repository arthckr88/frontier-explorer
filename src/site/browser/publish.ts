import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeBrowserNonstops, publishableFares, type BrowserFareFile } from "@/site/browser/integrate";
import type { BrowserResult } from "@/site/browser/types";
import type { ScheduleInput } from "@/site/network";

const root = fileURLToPath(new URL("../../../data/frontier-browser-cache/", import.meta.url));
const fareFile = new URL("../../../data/browser-fares.json", import.meta.url);
const flightsFile = new URL("../../../data/flights.json", import.meta.url);

const results = readdirSync(root)
  .filter((name) => name.endsWith(".json") && !name.startsWith("markets-"))
  .map((name) => JSON.parse(readFileSync(join(root, name), "utf8")) as BrowserResult);
const fares = publishableFares(results);
const published: BrowserFareFile = { source: "frontier_browser", fares };
writeFileSync(fareFile, `${JSON.stringify(published, null, 2)}\n`);
const schedule = JSON.parse(readFileSync(flightsFile, "utf8")) as ScheduleInput;
const merged = mergeBrowserNonstops(schedule, results);
if ((merged.flights?.length ?? 0) !== (schedule.flights?.length ?? 0)) {
  writeFileSync(flightsFile, `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`browser fares ${fares.length}; flights ${schedule.flights?.length ?? 0} -> ${merged.flights?.length ?? 0}`);
