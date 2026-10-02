import { readFileSync } from "node:fs";
import { attachBrowserFares, loadBrowserFareText } from "@/site/browser/integrate";
import { UNRESOLVED_MAPPING_THRESHOLD, hasNonstopEvidence } from "@/site/direct-routes";
import { buildNetwork, diagnostics, integrityErrors, type NetworkArtifact, type ScheduleInput } from "@/site/network";

const flightsPath = new URL("../../data/flights.json", import.meta.url);
const networkPath = new URL("../../data/network.json", import.meta.url);

let schedule: ScheduleInput;
let network: NetworkArtifact;
try {
  schedule = JSON.parse(readFileSync(flightsPath, "utf8")) as ScheduleInput;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("data/flights.json is missing or malformed.");
  process.exit(1);
}
try {
  network = JSON.parse(readFileSync(networkPath, "utf8")) as NetworkArtifact;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("data/network.json is missing or malformed. Run npm run normalize:network.");
  process.exit(1);
}

const fares = loadBrowserFareText(new URL("../../data/browser-fares.json", import.meta.url));
const scheduleWithFares = attachBrowserFares(schedule, fares);
const errors = integrityErrors(scheduleWithFares, network);
const rebuilt = buildNetwork(scheduleWithFares, network.today, network.official);
if (!network.official || network.official.routes.length === 0) errors.push("Official routes are zero.");
if ((network.official?.unresolved.length ?? 0) > UNRESOLVED_MAPPING_THRESHOLD) {
  errors.push(`Unresolved airport mappings ${network.official?.unresolved.length} exceed ${UNRESOLVED_MAPPING_THRESHOLD}.`);
}
if (JSON.stringify(rebuilt) !== JSON.stringify(network)) {
  errors.push("data/network.json does not match the booking observations. Run npm run normalize:network.");
}
if (!network.observations?.length) errors.push("The production artifact has no booking observations.");
const officialAirports = new Set(network.official?.airports ?? []);
for (const route of network.official?.routes ?? []) {
  if (!hasNonstopEvidence(route)) errors.push(`Official route ${route.origin}-${route.destination} has no explicit nonstop evidence.`);
  if (route.provenance !== "frontier_official_direct_route") errors.push(`Official route ${route.origin}-${route.destination} has no official provenance.`);
  if (!officialAirports.has(route.origin) || !officialAirports.has(route.destination)) {
    errors.push(`Official route ${route.origin}-${route.destination} references a missing airport.`);
  }
}
const priority = new Set(["OAK", "SFO", "LAS", "LAX", "BUR", "SAN", "ONT", "SNA"]);
if (officialAirports.size > 0 && [...officialAirports].every((code) => priority.has(code))) {
  errors.push("The network is limited to priority airports.");
}
for (const fare of fares) {
  if (fare.origin === "OAK" && fare.destination === "LAS" && fare.standard?.total === 50.98 && fare.date !== "2026-09-28") {
    errors.push("A September 28 OAK-LAS fare is attached to another date.");
  }
  if (fare.goWild && fare.goWild.total < 0) errors.push(`GoWild ${fare.origin}-${fare.destination} ${fare.date} uses a negative total.`);
  if ((fare.stops ?? 0) > 0 && (!fare.origin || !fare.destination || !fare.date || !fare.flightNumber || !fare.departureLocal || !fare.arrivalLocal)) {
    errors.push("A connection fare is missing itinerary fields.");
  }
}
for (const sample of network.official?.fareModules ?? []) {
  if (sample.total > sample.embedded && sample.status !== "complete" && sample.status !== "blocked") {
    errors.push(`${sample.origin} fare module still stops at the first page.`);
  }
}
const unexplained = (network.official?.discrepancies ?? []).filter((item) => !item.classification || !item.reason);
if (unexplained.length) errors.push(`${unexplained.length} schedule gaps have no classification.`);
for (const pair of [
  ["SFO", "LAX"],
  ["SFO", "SAN"],
  ["LAS", "LAX"],
  ["LAS", "BUR"],
]) {
  const official = network.official?.routes.some((route) => route.origin === pair[0] && route.destination === pair[1]);
  const gap = network.official?.discrepancies?.find((item) => item.origin === pair[0] && item.destination === pair[1]);
  if (!official && !gap) errors.push(`${pair[0]}-${pair[1]} is an unexplained discrepancy.`);
}
const observationKeys = new Set(network.observations.map((flight) => `${flight.origin}|${flight.destination}|${flight.date}|${flight.flightNumber}|${flight.departureLocal.slice(0, 16)}`));
for (const fare of fares) {
  if ((fare.stops ?? 0) === 0) continue;
  const key = `${fare.origin}|${fare.destination}|${fare.date}|${fare.flightNumber}|${fare.departureLocal.slice(0, 16)}`;
  const matching = network.observations.filter(
    (flight) =>
      flight.origin === fare.origin &&
      flight.destination === fare.destination &&
      flight.date === fare.date &&
      flight.flightNumber === fare.flightNumber &&
      flight.departureLocal.slice(0, 16) === fare.departureLocal.slice(0, 16) &&
      flight.arrivalLocal.slice(0, 16) === fare.arrivalLocal.slice(0, 16),
  );
  if (matching.length && !observationKeys.has(key)) errors.push(`Connection fare ${key} became a nonstop.`);
  if (matching.length) errors.push(`Connection fare ${fare.origin}-${fare.destination} ${fare.flightNumber} is stored as a nonstop with the connection arrival.`);
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(JSON.stringify(diagnostics(schedule, network), null, 2));
