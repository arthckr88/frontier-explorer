import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { untimedPaths } from "@/lib/graph/untimed";
import { findForbiddenMarkers } from "../../scripts/pages-secret-scan.mjs";
import { UNRESOLVED_MAPPING_THRESHOLD, hasNonstopEvidence } from "@/site/direct-routes";
import { normalizeFareItinerary } from "@/site/itinerary";
import { legacyPartialGoWild, staticAirportDetail, staticDirectory, staticFareLookup, staticNetworkAdapter, staticRouteDetail, storedGoWild } from "@/static/adapter";
import { loadCatalog } from "@/static/load";

const catalog = loadCatalog();
const PRIORITY = new Set(["OAK", "SFO", "LAS", "LAX", "BUR", "SAN", "ONT", "SNA"]);

describe("full network integrity", () => {
  it("publishes the official catalogue without collapsing layers", () => {
    const official = catalog.network.official;
    expect(official?.routes.length ?? 0).toBeGreaterThan(0);
    expect(official?.unresolved.length ?? 0).toBeLessThanOrEqual(UNRESOLVED_MAPPING_THRESHOLD);
    const airports = new Set(official?.airports ?? []);
    expect([...airports].every((code) => PRIORITY.has(code))).toBe(false);
    expect(airports.size).toBeGreaterThan(PRIORITY.size);
    for (const route of official?.routes ?? []) {
      expect(airports.has(route.origin)).toBe(true);
      expect(airports.has(route.destination)).toBe(true);
      expect(route.provenance).toBe("frontier_official_direct_route");
    }
    const published = new Set(catalog.airports.map((airport) => airport.iata));
    for (const code of airports) expect(published.has(code), code).toBe(true);
    const network = staticNetworkAdapter(catalog);
    const edges = new Set(network.routes.map((route) => `${route.origin}|${route.destination}`));
    for (const route of official?.routes ?? []) {
      if (catalog.airports.some((airport) => airport.iata === route.origin) && catalog.airports.some((airport) => airport.iata === route.destination)) {
        expect(edges.has(`${route.origin}|${route.destination}`)).toBe(true);
      }
    }
    const graph = network.routes.map((route) => ({ origin: route.origin, destination: route.destination, status: route.status, frequency: null }));
    const viaLas = untimedPaths(graph, ["OAK"], ["MCO"], 2).find((path) => path.airports.includes("LAS"));
    expect(viaLas?.airports[1]).toBe("LAS");
    expect(edges.has("OAK|PDX")).toBe(false);
    for (const route of official?.routes ?? []) expect(hasNonstopEvidence(route)).toBe(true);
  });

  it("keeps personal corridors and does not invent a route from a missing fare", () => {
    const oak = staticFareLookup(catalog, {
      origin: "OAK",
      destination: "LAS",
      date: "2026-09-28",
      maxStops: 0,
      maxDuration: null,
      depart: "",
      arrive: "",
      sort: "depart",
      excludeRedEyes: false,
    });
    expect(oak.flights.map((flight) => flight.flightNumber).sort()).toEqual(["2046", "3838"]);
    const denver = staticAirportDetail(catalog, "DEN");
    const route = staticRouteDetail(catalog, "DEN", "MCO");
    expect(denver?.airport.city).toMatch(/Denver/);
    expect(route?.official ?? false).toBe(false);
    expect(route?.hasSchedule ?? false).toBe(false);
    expect(route?.fareDates ?? []).toEqual([]);
    expect(staticAirportDetail(catalog, "ZZZ")).toBeNull();
    const directory = staticDirectory(catalog, {
      region: "all",
      country: "",
      scope: "all",
      origin: "DEN",
      destination: "MCO",
      officialOnly: true,
      confirmedOnly: false,
      faresOnly: false,
      query: "",
    });
    expect(directory.routes.some((item) => item.origin === "DEN" && item.destination === "MCO" && item.official)).toBe(false);
  });

  it("keeps marketed destinations out of direct routes throughout the published app", () => {
    expect(staticRouteDetail(catalog, "OAK", "PDX")?.official ?? false).toBe(false);
    expect(staticDirectory(catalog, { region: "all", country: "", scope: "all", origin: "OAK", destination: "PDX", officialOnly: false, confirmedOnly: false, faresOnly: false, query: "" }).routes).toEqual([]);
    expect(findForbiddenMarkers(JSON.stringify(catalog.network.official))).toEqual([]);
    const routes = catalog.network.official?.routes ?? [];
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(hasNonstopEvidence)).toBe(true);
  });

  it("classifies dated nonstops missing from the official layer and keeps connection fares off the nonstop graph", () => {
    const gaps = new Map((catalog.network.official?.discrepancies ?? []).map((item) => [`${item.origin}-${item.destination}`, item]));
    for (const pair of ["SFO-LAX", "SFO-SAN", "LAS-LAX", "LAS-BUR"]) {
      const [origin, destination] = pair.split("-");
      const official = catalog.network.official?.routes.some((route) => route.origin === origin && route.destination === destination);
      const gap = gaps.get(pair);
      expect(official || Boolean(gap?.reason)).toBe(true);
      if (!official) expect(gap?.classification).toBe("SCHEDULE_CONFIRMED_ONLY");
    }
    expect((catalog.network.official?.discrepancies ?? []).filter((item) => !item.reason)).toEqual([]);
    const network = staticNetworkAdapter(catalog);
    const edges = new Set(network.routes.map((route) => `${route.origin}|${route.destination}`));
    const connection = catalog.fares.find((fare) => (fare.stops ?? 0) > 0 && !edges.has(`${fare.origin}|${fare.destination}`));
    if (connection) expect(edges.has(`${connection.origin}|${connection.destination}`)).toBe(false);
    const graph = network.routes.map((route) => ({ origin: route.origin, destination: route.destination, status: route.status, frequency: null }));
    const avoided = untimedPaths(graph, ["BOS", "PHL", "MCO", "TPA", "FLL"], ["SJU", "CUN", "PUJ", "MBJ"], 2).find(
      (path) => path.stops > 0 && path.airports.every((code) => !["LAS", "DEN", "ATL"].includes(code)),
    );
    expect(avoided).toBeUndefined(); // No supported path remains after avoiding all captured hubs.
    const rows = storedGoWild(catalog);
    const keys = rows.map((row) => row.itineraryId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.some((row) => row.stops === 0)).toBe(true);
    expect(rows.every((row) => !row.legacy && row.segments.length === row.stops + 1)).toBe(true);
    const legacy = legacyPartialGoWild(catalog);
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.every((row) => row.legacy && row.segments.length === 0)).toBe(true);
    expect(new Set(legacy.map((row) => row.itineraryId)).size).toBe(legacy.length);
    expect(catalog.fares).toHaveLength(82);
    expect(catalog.priceHistory).toHaveLength(197);
    for (const fare of catalog.fares) {
      const normalized = normalizeFareItinerary(fare);
      expect(fare.completeness).toBe(normalized.completeness);
      expect(fare.itineraryId).toBe(normalized.itineraryId);
      if ((fare.stops ?? 0) > 0) {
        expect(fare.completeness).toBe("legacy_partial_itinerary");
        expect(fare.segments).toEqual([]);
      } else {
        expect(fare.completeness).toBe("complete");
        expect(fare.segments).toHaveLength(1);
      }
    }
    expect(readFileSync("src/views/gowild-view.tsx", "utf8")).not.toContain("first flight");
    expect(readFileSync("src/views/search-panel.tsx", "utf8")).not.toContain("first flight");
  });
});
