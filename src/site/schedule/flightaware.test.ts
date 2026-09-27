import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildNetwork, confirmedArcKeys } from "@/site/network";
import { describePair } from "@/site/view";
import { queriesBeforeCap } from "@/site/schedule/budget";
import { memoryCache, queryCacheKey } from "@/site/schedule/cache";
import { FlightAwareScheduleProvider, redactSecrets } from "@/site/schedule/flightaware";
import { mergeScheduleEvidence, type StoredFlight } from "@/site/schedule/merge";
import { normalizeAeroSchedules } from "@/site/schedule/normalize";
import { planFlightAware } from "@/site/schedule/plan";
import { planScheduleChecks } from "@/site/update-plan";

const TODAY = "2026-09-27";
const ZONES = new Map([
  ["SFO", "America/Los_Angeles"],
  ["LAX", "America/Los_Angeles"],
  ["OAK", "America/Los_Angeles"],
  ["LAS", "America/Los_Angeles"],
  ["BUR", "America/Los_Angeles"],
]);
const SECRET = "flightaware-test-key-9f3c";

describe("FlightAware cheap schedule plan", () => {
  const plan = planFlightAware({ today: TODAY, mode: "near", maxPages: 2, maxCostUsd: 4 });

  it("covers the priority corridors and no other airline", () => {
    const pairs = plan.queries.filter((query) => query.endpoint === "schedules").map((query) => `${query.origin}-${query.destination}`);
    for (const pair of ["SFO-LAX", "OAK-LAS", "LAS-OAK", "SFO-LAS", "LAS-LAX", "LAS-BUR", "LAX-SFO", "BUR-LAS"]) {
      expect(pairs).toContain(pair);
    }
    expect(plan.airports).toEqual(["OAK", "SFO", "LAS", "LAX", "BUR", "SAN", "ONT", "SNA"]);
    expect(plan.queries.every((query) => query.airline === "FFT")).toBe(true);
    expect(pairs).not.toContain("SFO-DEN");
    expect(plan.days).toBe(14);
    expect(plan.maximumCostUsd).toBeLessThanOrEqual(4);
    expect(plan.stoppedByCostCap).toBe(false);
  });

  it("stops a full-year plan before the cost cap", () => {
    const full = planFlightAware({ today: TODAY, mode: "full", maxPages: 2, maxCostUsd: 4 });
    expect(full.stoppedByCostCap).toBe(true);
    expect(full.maximumCostUsd).toBeLessThanOrEqual(4);
    expect(full.allowedQueries.length).toBeLessThan(full.queries.length);
    expect(full.cadence).toMatch(/manual/);
  });

  it("aborts before a query that would exceed the cap", () => {
    const queries = planFlightAware({ today: TODAY, mode: "near", includeOperatorLookup: true, maxPages: 2, maxCostUsd: 4 }).queries;
    const guarded = queriesBeforeCap(queries, 0.03);
    expect(guarded.stopped).toBe(true);
    expect(guarded.allowed.map((query) => query.endpoint)).toEqual(["operator"]);
    expect(guarded.maxCostUsd).toBeLessThanOrEqual(0.03);
  });
});

describe("FlightAware rows are scheduled evidence", () => {
  it("counts two Frontier flights on one day as two departures", () => {
    const flights = normalizeAeroSchedules(
      [
        row("FFT3308", "SFO", "LAX", "2026-10-01T16:00:00Z", "2026-10-01T17:37:00Z"),
        row("FFT2858", "SFO", "LAX", "2026-10-01T19:07:00Z", "2026-10-01T20:40:00Z"),
        row("UAL100", "SFO", "LAX", "2026-10-01T18:00:00Z", "2026-10-01T19:20:00Z"),
        { ...row("FFT999", "SFO", "LAX", "2026-10-01T21:00:00Z", "2026-10-01T22:20:00Z"), actual_ident_icao: "UAL999" },
      ],
      ZONES,
      "2026-09-27T12:00:00Z",
      { origin: "SFO", destination: "LAX" },
    );
    expect(flights.map((flight) => flight.flightNumber)).toEqual(["3308", "2858"]);
    expect(flights.every((flight) => flight.provenance === "flightaware_schedule")).toBe(true);
    const summary = describePair("SFO", "LAX", flights, [], TODAY);
    expect(summary.futureDepartureCount).toBe(2);
    expect(summary.departuresPhrase).toContain("2 departures");
    const network = buildNetwork({ flights, routes: [{ origin: "SFO", destination: "LAX", provenance: "listed" }] }, TODAY);
    expect(confirmedArcKeys(network, TODAY)).toContain("SFO|LAX");
  });

  it("does not let a listed market become an arc without a dated flight", () => {
    const network = buildNetwork({ flights: [], routes: [{ origin: "OAK", destination: "BUR", provenance: "listed" }] }, TODAY);
    expect(confirmedArcKeys(network, TODAY)).not.toContain("OAK|BUR");
  });
});

describe("booking checks stay distinct from FlightAware absence", () => {
  const booking = flight("SFO", "LAX", "3308", "2026-10-01T09:00:00");

  it("keeps a blocked date blocked and an unqueried date unchecked", () => {
    const merged = mergeScheduleEvidence(
      { flights: [], checked: [], blocked: ["SFO|LAX|2026-10-01"] },
      [
        {
          origin: "SFO",
          destination: "LAX",
          dateStart: "2026-10-01",
          dateEnd: "2026-10-02",
          complete: true,
          flights: [],
        },
      ],
    );
    expect(merged.blocked).toEqual(["SFO|LAX|2026-10-01"]);
    expect(merged.checked).toEqual([]);
    expect(merged.flights).toEqual([]);
    expect(merged.disagreements).toEqual([]);
    expect(merged.checked.join(" ")).not.toContain("2026-10-05");
  });

  it("keeps both rows when a published flight disagrees with a booking time", () => {
    const scheduled = flight("SFO", "LAX", "3308", "2026-10-01T11:00:00");
    scheduled.provenance = "flightaware_schedule";
    const merged = mergeScheduleEvidence({ flights: [booking], checked: ["SFO|LAX|2026-10-01"], blocked: ["LAS|BUR|2026-10-17"] }, [
      {
        origin: "SFO",
        destination: "LAX",
        dateStart: "2026-10-01",
        dateEnd: "2026-10-02",
        complete: true,
        flights: [scheduled],
      },
    ]);
    expect(merged.flights).toHaveLength(2);
    expect(merged.blocked).toEqual(["LAS|BUR|2026-10-17"]);
    expect(merged.checked).toEqual(["SFO|LAX|2026-10-01"]);
    expect(merged.disagreements.map((item) => item.kind)).toEqual(["time"]);
    const summary = describePair(
      "SFO",
      "LAX",
      merged.flights.map((item) => ({
        ...item,
        source: item.provenance === "flightaware_schedule" ? "FlightAware published schedule" : "Frontier public booking observations",
        retrievedAt: item.retrievedAt ?? null,
      })),
      [],
      TODAY,
    );
    expect(summary.futureDepartureCount).toBe(1);
  });
});

describe("FlightAware client budget and cache", () => {
  it("does not repeat a cached query or spend past the cap", async () => {
    const provider = new FlightAwareScheduleProvider();
    const plan = provider.plan({ today: TODAY, mode: "near", maxPages: 2, maxCostUsd: 4, includeOperatorLookup: false });
    const query = plan.queries.find((item) => item.origin === "OAK" && item.destination === "LAS");
    expect(query).toBeTruthy();
    let calls = 0;
    const cache = memoryCache();
    const transport = async () => {
      calls += 1;
      return { status: 200, numPages: 1, body: { scheduled: [], num_pages: 1, links: null } };
    };
    await provider.fetchSchedule(query!, { apiKey: SECRET, cache, transport, zones: ZONES, capUsd: 4, spentUsd: 0 });
    await provider.fetchSchedule(query!, { apiKey: SECRET, cache, transport, zones: ZONES, capUsd: 4, spentUsd: 0 });
    expect(calls).toBe(1);
    expect(cache.get(queryCacheKey(query!), new Date())?.body).toBeTruthy();
    await expect(
      provider.fetchSchedule(query!, { apiKey: SECRET, cache: memoryCache(), transport, zones: ZONES, capUsd: 0.01, spentUsd: 0 }),
    ).rejects.toThrow(/cap/);
    expect(calls).toBe(1);
  });

  it("keeps the API key out of dry-run text and generated Pages files", () => {
    const provider = new FlightAwareScheduleProvider();
    const text = redactSecrets(provider.dryRun({ today: TODAY, mode: "near" }, true), SECRET);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("GET /schedules/");
    expect(text).not.toContain("x-apikey");
    const copied = ["site/app.js", "site/index.html", "dist/app.js", "dist/index.html", "dist/network.json", "dist/view.js", "dist/search.js"];
    for (const file of copied) {
      if (!existsSync(file)) continue;
      const body = readFileSync(file, "utf8");
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain("x-apikey");
      expect(body).not.toContain("FLIGHTAWARE_API_KEY");
    }
  });
});

describe("Frontier booking verifier stays on the corridors", () => {
  it("does not plan a listed market or a non-priority airport", () => {
    const plan = planScheduleChecks({
      today: TODAY,
      flights: [],
      checked: [],
      blocked: [],
      routes: [{ origin: "SFO", destination: "DEN", provenance: "listed" }],
    });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((item) => ["OAK", "SFO", "LAS", "LAX", "BUR", "SAN", "ONT", "SNA"].includes(item.origin))).toBe(true);
    expect(plan.some((item) => item.destination === "DEN" || item.origin === "JFK")).toBe(false);
    expect(plan.some((item) => item.reason === "listed-probe")).toBe(false);
  });
});

function row(ident: string, origin: string, destination: string, out: string, inn: string) {
  return {
    ident_icao: ident,
    ident,
    origin_iata: origin,
    destination_iata: destination,
    scheduled_out: out,
    scheduled_in: inn,
    blocked: false,
  };
}

function flight(origin: string, destination: string, flightNumber: string, departureLocal: string): StoredFlight {
  return {
    origin,
    destination,
    flightNumber,
    date: departureLocal.slice(0, 10),
    departureLocal,
    arrivalLocal: departureLocal,
    departureUtc: `${departureLocal}Z`,
    arrivalUtc: `${departureLocal.slice(0, 11)}12:00:00Z`,
    provenance: "frontier_booking",
  };
}
