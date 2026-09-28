import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { passengerRoutesAreRanked } from "@/site/popularity-metrics";
import { staticNetworkAdapter } from "@/static/adapter";
import { loadCatalog } from "@/static/load";
import type { HistoricalMetrics } from "@/static/types";

const metrics = JSON.parse(readFileSync(new URL("../../data/historical-metrics.json", import.meta.url), "utf8")) as HistoricalMetrics;
const nonstops = JSON.parse(readFileSync(new URL("../../data/nonstops.json", import.meta.url), "utf8")) as {
  pairs: { origin: string; destination: string }[];
};

describe("historical passenger totals", () => {
  it("ranks official T-100 passenger totals without creating a current route", () => {
    const popularity = metrics.popularity;
    expect(popularity.passengersStored).toBe(true);
    expect(popularity.source).toBe("US DOT T-100 Segment (All Carriers)");
    expect(popularity.sourceUrl).toContain("transtats.bts.gov");
    expect(popularity.periodStart).toBe("2025-07");
    expect(popularity.periodEnd).toBe("2026-06");
    expect(popularity.note).toBe("Historical DOT/BTS data. Not proof of current Frontier service.");
    expect(passengerRoutesAreRanked(popularity.routes)).toBe(true);
    expect(popularity.routes.every((route) => Number.isInteger(route.passengers) && Number.isInteger(route.departuresPerformed))).toBe(true);
    const denLas = popularity.routes.find((route) => route.origin === "DEN" && route.destination === "LAS");
    const lasDen = popularity.routes.find((route) => route.origin === "LAS" && route.destination === "DEN");
    expect(denLas?.passengers).toBeGreaterThan(0);
    expect(lasDen?.passengers).toBeGreaterThan(0);
    expect(denLas?.passengers).not.toBe(lasDen?.passengers);
    expect(denLas?.departuresPerformed).toBeGreaterThan(0);
    const ranked = new Set(popularity.routes.map((route) => `${route.origin}|${route.destination}`));
    const pairs = new Set(nonstops.pairs.map((pair) => `${pair.origin}|${pair.destination}`));
    expect(ranked).toEqual(pairs);
    expect(metrics.frequency.current).toBe("Insufficient schedule coverage.");
    expect(metrics.frequency.historicalPeriod).toBe("2025-07-01 through 2026-07-31");
    expect(metrics.frequency.routes[0]).toMatchObject({ origin: "DEN", destination: "LAS", departures: 1687, perWeek: 29.9 });
    const catalog = loadCatalog();
    const drawn = new Set(staticNetworkAdapter(catalog).routes.map((route) => `${route.origin}|${route.destination}`));
    const official = new Set((catalog.network.official?.routes ?? []).map((route) => `${route.origin}|${route.destination}`));
    const historicalOnly = popularity.routes.filter((route) => !official.has(`${route.origin}|${route.destination}`));
    expect(historicalOnly.length).toBeGreaterThan(0);
    const confirmed = new Set(catalog.network.observations.map((flight) => `${flight.origin}|${flight.destination}`));
    for (const route of historicalOnly) {
      const key = `${route.origin}|${route.destination}`;
      if (!confirmed.has(key)) expect(drawn.has(key)).toBe(false);
    }
  });
});
