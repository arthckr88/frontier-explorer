import { readFileSync, writeFileSync } from "node:fs";
import { passengerRoutesAreRanked, rankPassengerRoutes, type PassengerRoute } from "@/site/popularity-metrics";

const outputPath = new URL("../../data/historical-metrics.json", import.meta.url);
const passengersPath = new URL("../../data/t100-passengers.json", import.meta.url);

type OperatingDays = {
  daily: {
    sourceName: string;
    sourceUrl: string;
    periodStart: string;
    periodEnd: string;
    flights: Record<string, string[]>;
  };
};

type PassengerExtract = {
  source: string;
  sourceUrl: string;
  periodStart: string;
  periodEnd: string;
  routes: PassengerRoute[];
};

const operating = JSON.parse(readFileSync(new URL("../../data/operating-days.json", import.meta.url), "utf8")) as OperatingDays;
const passengers = JSON.parse(readFileSync(passengersPath, "utf8")) as PassengerExtract;
const periodWeeks = weeksBetween(operating.daily.periodStart, operating.daily.periodEnd);
const frequency = Object.entries(operating.daily.flights)
  .map(([pair, rows]) => {
    const [origin, destination] = pair.split("|");
    const departures = rows.length;
    return {
      origin: origin ?? "",
      destination: destination ?? "",
      departures,
      perWeek: Math.round((departures / periodWeeks) * 10) / 10,
    };
  })
  .filter((row) => row.origin && row.destination && row.departures > 0)
  .sort((left, right) => right.departures - left.departures || left.origin.localeCompare(right.origin) || left.destination.localeCompare(right.destination));

const routes = rankPassengerRoutes(passengers.routes);
if (!routes.length || !passengerRoutesAreRanked(routes)) {
  throw new Error("T-100 passenger totals are missing or unsorted.");
}

const metrics = {
  frequency: {
    current: "Insufficient schedule coverage.",
    currentNote: "One captured date is not a weekly frequency. Current departures per week are omitted.",
    historicalSource: operating.daily.sourceName,
    historicalUrl: operating.daily.sourceUrl,
    historicalPeriod: `${operating.daily.periodStart} through ${operating.daily.periodEnd}`,
    historicalNote: "Historical DOT/BTS departures. Not current Frontier service, and not a route catalogue.",
    routes: frequency.slice(0, 40),
  },
  popularity: {
    source: passengers.source,
    sourceUrl: passengers.sourceUrl,
    period: `${passengers.periodStart} through ${passengers.periodEnd}`,
    periodStart: passengers.periodStart,
    periodEnd: passengers.periodEnd,
    passengersStored: true,
    note: "Historical DOT/BTS data. Not proof of current Frontier service.",
    routes,
  },
};

writeFileSync(outputPath, `${JSON.stringify(metrics)}\n`);
console.log(
  JSON.stringify(
    {
      historicalFrequencyRoutes: metrics.frequency.routes.length,
      passengerRoutes: metrics.popularity.routes.length,
      passengersStored: metrics.popularity.passengersStored,
      period: metrics.popularity.period,
    },
    null,
    2,
  ),
);

function weeksBetween(start: string, end: string) {
  const span = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.max(1, span / 86_400_000 / 7);
}
