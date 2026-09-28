import { readFileSync, writeFileSync } from "node:fs";

const outputPath = new URL("../../data/historical-metrics.json", import.meta.url);

type OperatingDays = {
  daily: {
    sourceName: string;
    sourceUrl: string;
    periodStart: string;
    periodEnd: string;
    flights: Record<string, string[]>;
  };
};

type Nonstops = {
  sourceName: string;
  sourceUrl: string;
  periodStart: string;
  periodEnd: string;
  pairs: { origin: string; destination: string }[];
};

const operating = JSON.parse(readFileSync(new URL("../../data/operating-days.json", import.meta.url), "utf8")) as OperatingDays;
const nonstops = JSON.parse(readFileSync(new URL("../../data/nonstops.json", import.meta.url), "utf8")) as Nonstops;
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
    source: nonstops.sourceName,
    sourceUrl: nonstops.sourceUrl,
    period: `${nonstops.periodStart} through ${nonstops.periodEnd}`,
    passengersStored: false,
    note: "Passenger totals are not in the stored T-100 extract. These city pairs had passengers greater than zero. They are historical volume evidence only and do not create a current route.",
    pairs: nonstops.pairs,
  },
};

writeFileSync(outputPath, `${JSON.stringify(metrics)}\n`);
console.log(
  JSON.stringify(
    {
      historicalFrequencyRoutes: metrics.frequency.routes.length,
      historicalPairs: metrics.popularity.pairs.length,
      passengersStored: false,
    },
    null,
    2,
  ),
);

function weeksBetween(start: string, end: string) {
  const span = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.max(1, span / 86_400_000 / 7);
}
