import { readFileSync } from "node:fs";
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

const errors = integrityErrors(schedule, network);
const rebuilt = buildNetwork(schedule, network.today);
if (JSON.stringify(rebuilt) !== JSON.stringify(network)) {
  errors.push("data/network.json does not match the booking observations. Run npm run normalize:network.");
}
if (!network.observations?.length) errors.push("The production artifact has no booking observations.");
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(JSON.stringify(diagnostics(schedule, network), null, 2));
