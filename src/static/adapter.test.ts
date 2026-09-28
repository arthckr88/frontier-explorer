import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { displayFare, staticFareLookup, staticNetworkAdapter } from "@/static/adapter";
import { loadCatalog } from "@/static/load";
import type { BrowserFareRecord } from "@/site/network";
import type { FareQuery, StaticCatalog } from "@/static/types";

const catalog = loadCatalog();
const open: FareQuery = {
  origin: "OAK",
  destination: "LAS",
  date: "2026-09-28",
  maxStops: 2,
  maxDuration: null,
  depart: "",
  arrive: "",
  sort: "depart",
  excludeRedEyes: false,
};

describe("static fare lookup", () => {
  it("keeps OAK to LAS on 2026-09-28 fares", () => {
    const result = staticFareLookup(catalog, open);
    const flights = result.flights.filter((flight) => flight.stops === 0);
    expect(flights.map((flight) => flight.flightNumber).sort()).toEqual(["2046", "3838"]);
    for (const flight of flights) {
      expect(flight.standard).toEqual({ total: 50.98, display: 51, currency: "USD" });
      expect(flight.discountDen).toEqual({ total: 49.98, display: 50, currency: "USD" });
      expect(flight.goWild).toEqual({ total: 15.41, display: 16, currency: "USD" });
    }
  });

  it("keeps September 28 fares for the other stored markets", () => {
    for (const [origin, destination] of [
      ["SFO", "LAX"],
      ["SFO", "LAS"],
      ["LAS", "LAX"],
      ["LAS", "BUR"],
      ["LAS", "OAK"],
      ["SAN", "LAS"],
    ] as const) {
      const raw = catalog.fares.filter((fare) => fare.origin === origin && fare.destination === destination && fare.date === "2026-09-28");
      const result = staticFareLookup(catalog, { ...open, origin, destination, date: "2026-09-28" });
      expect(raw.length).toBeGreaterThan(0);
      for (const fare of raw) {
        const match = result.flights.find(
          (flight) =>
            flight.flightNumber === fare.flightNumber &&
            flight.departureLocal.slice(0, 16) === fare.departureLocal.slice(0, 16) &&
            flight.arrivalLocal.slice(0, 16) === fare.arrivalLocal.slice(0, 16),
        );
        expect(match, `${origin}-${destination} ${fare.flightNumber}`).toBeTruthy();
        expect(match?.standard?.total ?? null).toBe(fare.standard?.total ?? null);
        expect(match?.standard?.display ?? null).toBe(fare.standard?.display ?? null);
        expect(match?.discountDen?.total ?? null).toBe(fare.discountDen?.total ?? null);
        expect(match?.discountDen?.display ?? null).toBe(fare.discountDen?.display ?? null);
        expect(match?.goWild?.total ?? null).toBe(displayFare(fare.goWild)?.total ?? null);
        expect(match?.goWild?.display ?? null).toBe(displayFare(fare.goWild)?.display ?? null);
      }
    }
  });

  it("shows the October 23 OAK to LAS schedule without September 28 fares", () => {
    const result = staticFareLookup(catalog, { ...open, date: "2026-10-23" });
    expect(result.message).toBeNull();
    expect(result.flights.map((flight) => [flight.flightNumber, flight.departureLocal.slice(11, 16), flight.arrivalLocal.slice(11, 16)])).toEqual([
      ["2046", "09:50", "11:25"],
      ["3838", "17:20", "18:55"],
    ]);
    expect(JSON.stringify(result.flights)).not.toContain("50.98");
    expect(result.flights.every((flight) => flight.standard == null && flight.discountDen == null && flight.goWild == null)).toBe(true);
  });

  it("does not treat a missing date as an empty or unchecked explanation", () => {
    const result = staticFareLookup(catalog, { ...open, date: "2026-12-01" });
    expect(result.flights).toEqual([]);
    expect(result.message).toBe("No stored Frontier schedule for this date.");
  });

  it("does not price GoWild -1", () => {
    expect(displayFare({ available: true, total: -1, display: -1, currency: "USD" })).toBeNull();
  });
});

describe("static network", () => {
  it("draws only stored nonstops", () => {
    const network = staticNetworkAdapter(catalog);
    expect(network.confirmedPairs).toBe(21);
    expect(network.routes).toHaveLength(21);
    expect(catalog.network.observations).toHaveLength(410);
    expect(catalog.network.observations.some((flight) => flight.date > "2026-10-25")).toBe(false);
    expect(catalog.network.observations.some((flight) => flight.date === "2026-10-25")).toBe(true);
  });

  it("does not turn a connection fare or a listed market into a nonstop arc", () => {
    const fare = {
      origin: "OAK",
      destination: "BUR",
      date: "2026-09-28",
      carrier: "F9",
      flightNumber: "1",
      departureLocal: "2026-09-28T10:00:00",
      arrivalLocal: "2026-09-28T14:00:00",
      durationMinutes: 240,
      stops: 1,
      standard: { available: true, total: 10, display: 10, currency: "USD" },
      discountDen: null,
      goWild: { available: true, total: -1, display: -1, currency: "USD" },
      seatsRemaining: null,
      retrievedAt: "2026-09-27T00:00:00.000Z",
      source: "frontier_browser",
    } satisfies BrowserFareRecord;
    const synthetic = {
      network: {
        ...catalog.network,
        observations: [],
        summaries: [],
        candidateCount: 3,
      },
      fares: [fare],
      changes: { windowDays: 90, events: [] },
      priceHistory: [],
      airports: catalog.airports,
    } satisfies StaticCatalog;
    expect(staticNetworkAdapter(synthetic).routes).toEqual([]);
    const lookup = staticFareLookup(synthetic, { ...open, destination: "BUR" });
    expect(lookup.flights[0]?.stops).toBe(1);
    expect(lookup.flights[0]?.goWild).toBeNull();
  });
});

describe("consumer copy", () => {
  it("keeps diagnostic phrases out of the consumer screens", () => {
    const files = [
      "src/views/home-view.tsx",
      "src/views/search-panel.tsx",
      "src/views/discover-view.tsx",
      "src/views/planner-view.tsx",
      "src/views/gowild-view.tsx",
      "src/views/airport-view.tsx",
      "src/views/route-view.tsx",
      "src/views/settings-view.tsx",
      "src/components/shell.tsx",
      "src/components/explorer-map.tsx",
    ];
    const forbidden = [/not checked yet/i, /booking observations/i, /weekly frequency/i, /\bunchecked\b/i, /\bcoverage\b/i, /\bunknown\b/i];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) expect(text, file).not.toMatch(pattern);
    }
  });
});
