import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { untimedPaths } from "@/lib/graph/untimed";
import { findForbiddenMarkers } from "../../scripts/pages-secret-scan.mjs";
import { UNRESOLVED_MAPPING_THRESHOLD } from "@/site/direct-routes";
import { staticAirportDetail, staticDirectory, staticFareLookup, staticNetworkAdapter, staticRouteDetail } from "@/static/adapter";
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
    const viaDen = untimedPaths(graph, ["OAK"], ["MCO"], 2).find((path) => path.airports.includes("DEN"));
    expect(viaDen?.airports[1]).toBe("DEN");
    for (let index = 0; viaDen && index < viaDen.airports.length - 1; index += 1) {
      expect(edges.has(`${viaDen.airports[index]}|${viaDen.airports[index + 1]}`)).toBe(true);
    }
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
    expect(route?.official).toBe(true);
    expect(route?.hasSchedule).toBe(false);
    expect(route?.fareDates).toEqual([]);
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
    expect(directory.routes.some((item) => item.origin === "DEN" && item.destination === "MCO" && item.official && !item.fares)).toBe(true);
  });

  it("covers twenty official routes across the network and skips a code the file does not contain", () => {
    const points = new Map(catalog.airports.map((airport) => [airport.iata, airport]));
    const wanted = ["JFK"];
    for (const code of wanted) {
      if (!catalog.network.official?.airports.includes(code)) continue;
      expect(staticAirportDetail(catalog, code)).not.toBeNull();
    }
    const bands = new Map<string, string[]>();
    for (const route of catalog.network.official?.routes ?? []) {
      const airport = points.get(route.origin);
      if (!airport) continue;
      const band = bandOf(airport.lat, airport.lon, airport.country, airport.region);
      const list = bands.get(band) ?? [];
      if (list.length < 4) list.push(`${route.origin}-${route.destination}`);
      bands.set(band, list);
    }
    expect([...bands.keys()].sort()).toEqual([
      "caribbean_international",
      "florida",
      "midwest",
      "mountain_central",
      "northeast",
      "south",
      "west",
    ]);
    const lists = [...bands.values()];
    const matrix: string[] = [];
    for (let index = 0; matrix.length < 20; index += 1) {
      const item = lists[index % lists.length]?.[Math.floor(index / lists.length)];
      if (item) matrix.push(item);
    }
    expect(matrix.length).toBeGreaterThanOrEqual(20);
    for (const pair of matrix) {
      const [origin, destination] = pair.split("-");
      expect(staticRouteDetail(catalog, origin ?? "", destination ?? "")?.official).toBe(true);
    }
    expect(findForbiddenMarkers(JSON.stringify(catalog.network.official)).length).toBe(0);
  });
});

function bandOf(lat: number, lon: number, country: string, region: string) {
  if (country !== "US" || region === "caribbean") return "caribbean_international";
  if (lat >= 24.4 && lat <= 31.1 && lon >= -87.7 && lon <= -80) return "florida";
  if (lon <= -115) return "west";
  if (lon <= -100) return "mountain_central";
  if (lat >= 39 && lon >= -83) return "northeast";
  if (lon <= -85) return "midwest";
  return "south";
}

describe("secret scan fixture", () => {
  it("reads the published catalogue from disk", () => {
    const text = readFileSync(new URL("../../data/frontier-direct-routes.json", import.meta.url), "utf8");
    expect(findForbiddenMarkers(text)).toEqual([]);
    expect(text).toContain("Frontier official direct routes");
  });
});
