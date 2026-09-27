import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { availabilityRouteEvent } from "@/site/availability/changes";
import { availabilityCacheKey, memoryAvailabilityCache, searchCached } from "@/site/availability/cache";
import { priceHistoryFrom } from "@/site/availability/history";
import { AVAILABILITY_FIELD_PATHS, normalizeAvailabilityPayload } from "@/site/availability/normalize";
import { FrontierAvailabilityProvider, availabilityRequest } from "@/site/availability/provider";
import type { AvailabilitySearchResult, AvailabilityTransport } from "@/site/availability/types";
import { buildNetwork, confirmedArcKeys } from "@/site/network";
const require = createRequire(import.meta.url);
const { findForbiddenMarkers } = require("../../../scripts/pages-secret-scan.mjs") as {
  findForbiddenMarkers: (text: string) => string[];
};

const TODAY = "2026-09-27";
const QUERY = { origin: "OAK", destination: "LAS", date: "2026-09-28" };

describe("Frontier availability normalization", () => {
  it("keeps standard and GoWild prices independently, with unknown Discount Den", () => {
    const normalized = normalizeAvailabilityPayload({
      flights: [
        {
          flightNumber: "2046",
          departTime: "2026-09-28T10:17:00",
          arriveTime: "2026-09-28T11:58:00",
          stops: 0,
          segments: [
            {
              designator: { origin: "OAK", destination: "LAS", departure: "2026-09-28T10:17:00", arrival: "2026-09-28T11:58:00" },
              identifier: { carrierCode: "F9", identifier: "2046" },
            },
          ],
          fares: [
            {
              standardfareAvailabilityKey: "std",
              gowildfareAvailabilityKey: "gw",
              fareBundleInfo: {
                std: { economyBundlePrice: 149, currencyCode: "USD" },
                gw: { economyBundlePrice: 19.01, currencyCode: "USD", seatsRemaining: 3 },
              },
            },
          ],
        },
      ],
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const flight = normalized.flights[0];
    expect(flight?.stops).toBe(0);
    expect(flight?.segments).toHaveLength(1);
    expect(flight?.standard).toEqual({ amount: 149, currency: "USD", seatsRemaining: null });
    expect(flight?.goWild).toEqual({ amount: 19.01, currency: "USD", seatsRemaining: 3 });
    expect(flight?.discountDen).toEqual({ amount: null, currency: null, seatsRemaining: null });
    expect(flight?.departureTime).toBe("2026-09-28T10:17:00");
    expect(flight?.arrivalTime).toBe("2026-09-28T11:58:00");
  });

  it("reads a Discount Den bundle and historic GoWild seats when those fields are present", () => {
    const normalized = normalizeAvailabilityPayload([
      {
        departTime: "08:00",
        arriveTime: "09:20",
        stops: 0,
        goWildFare: 22,
        goWildFareSeatsRemaining: 2,
        discountDenFare: 80,
        fares: [
          {
            discountdenfareAvailabilityKey: "dd",
            fareBundleInfo: {
              dd: { economyBundlePrice: 80, seatsRemaining: 4 },
            },
          },
        ],
      },
    ]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.flights[0]?.discountDen).toEqual({ amount: 80, currency: null, seatsRemaining: 4 });
    expect(normalized.flights[0]?.goWild).toEqual({ amount: 22, currency: null, seatsRemaining: 2 });
    expect(normalized.flights[0]?.standard.amount).toBeNull();
  });

  it("returns every flight, including a connection", () => {
    const normalized = normalizeAvailabilityPayload({
      journeys: [
        {
          flights: [
            { flightNumber: "2046", departTime: "10:17", arriveTime: "11:58", stops: 0, legs: [{ departureStation: "OAK", arrivalStation: "LAS", flightNumber: "2046", departureDate: "10:17", arrivalDate: "11:58" }] },
            {
              flightNumber: "100",
              stops: 1,
              segments: [
                { designator: { origin: "OAK", destination: "DEN", departure: "08:00", arrival: "11:30" }, identifier: { identifier: "100" } },
                { designator: { origin: "DEN", destination: "LAS", departure: "13:00", arrival: "14:10" }, identifier: { identifier: "200" } },
              ],
            },
          ],
        },
      ],
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.flights).toHaveLength(2);
    expect(normalized.flights[0]?.stops).toBe(0);
    expect(normalized.flights[0]?.segments[0]?.origin).toBe("OAK");
    expect(normalized.flights[1]?.stops).toBe(1);
    expect(normalized.flights[1]?.segments.map((segment) => segment.destination)).toEqual(["DEN", "LAS"]);
    expect(normalized.flights[1]?.departureTime).toBe("08:00");
    expect(normalized.flights[1]?.arrivalTime).toBe("14:10");
  });

  it("treats an empty flight list as no flights and a bad shape as unreadable", () => {
    expect(normalizeAvailabilityPayload({ flights: [] })).toEqual({ ok: true, flights: [] });
    expect(normalizeAvailabilityPayload({ flights: "nope" }).ok).toBe(false);
    expect(normalizeAvailabilityPayload({ surprise: true }).ok).toBe(false);
  });

  it("documents the paths it reads", () => {
    expect(AVAILABILITY_FIELD_PATHS.standardAmount[0]).toContain("standardfareAvailabilityKey");
    expect(AVAILABILITY_FIELD_PATHS.goWildAmount).toContain("goWildFare");
    expect(AVAILABILITY_FIELD_PATHS.goWildSeats).toContain("goWildFareSeatsRemaining");
  });
});

describe("FrontierAvailabilityProvider", () => {
  it("sends one unauthenticated JSON search and no credential headers", () => {
    const request = availabilityRequest(QUERY);
    expect(request.url).toContain("FlightAvailabilitySimpleSearch");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body).flightAvailabilityRequestModel).toMatchObject({
      origin: "OAK",
      destination: "LAS",
      beginDate: "2026-09-28",
    });
    expect(findForbiddenMarkers(JSON.stringify(request))).toEqual([]);
    expect(Object.keys(request.headers).sort()).toEqual(["accept", "content-type", "user-agent"]);
  });

  it("classifies an empty 406 as blocked", async () => {
    const transport = vi.fn<AvailabilityTransport>(async () => ({ status: 406, contentType: null, body: "" }));
    const result = await new FrontierAvailabilityProvider(transport).search(QUERY);
    expect(result).toMatchObject({ status: "blocked", httpStatus: 406, flights: [] });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("classifies 401 as unauthorized, a thrown request as network_error, and bad JSON as parse_error", async () => {
    expect((await searchWith({ status: 401, contentType: "application/json", body: "{}" })).status).toBe("unauthorized");
    expect((await searchWith({ status: 429, contentType: null, body: "" })).status).toBe("blocked");
    const broken = new FrontierAvailabilityProvider(async () => {
      throw new Error("socket hang up");
    });
    expect((await broken.search(QUERY)).status).toBe("network_error");
    expect((await searchWith({ status: 200, contentType: "application/json", body: "{" })).status).toBe("parse_error");
    expect((await searchWith({ status: 200, contentType: "text/html", body: "<html></html>" })).status).toBe("parse_error");
  });

  it("returns an empty ok result and does not invent a fare", async () => {
    const result = await searchWith({ status: 200, contentType: "application/json", body: "[]" });
    expect(result.status).toBe("ok");
    expect(result.flights).toEqual([]);
  });
});

describe("availability cache, price history, and route events", () => {
  it("caches by origin|destination|date and does not call the transport again before expiry", async () => {
    const transport = vi.fn<AvailabilityTransport>(async () => ({ status: 200, contentType: "application/json", body: "[]" }));
    const provider = new FrontierAvailabilityProvider(transport);
    const cache = memoryAvailabilityCache();
    const now = new Date("2026-09-27T12:00:00Z");
    const first = await searchCached(provider, cache, QUERY, now, 60_000);
    const second = await searchCached(provider, cache, QUERY, new Date(now.getTime() + 1_000), 60_000);
    expect(first.status).toBe("ok");
    expect(second).toEqual(first);
    expect(transport).toHaveBeenCalledOnce();
    const stored = cache.get(availabilityCacheKey(QUERY), now);
    expect(stored?.key).toBe("OAK|LAS|2026-09-28");
    expect(stored?.source).toBe("frontier_availability");
    expect(stored?.retrievedAt).toBe("2026-09-27T12:00:00.000Z");
    expect(stored?.expiresAt).toBe("2026-09-27T12:01:00.000Z");
    expect(cache.get(availabilityCacheKey(QUERY), new Date("2026-09-27T12:01:00Z"))).toBeNull();
  });

  it("records one price-history row per returned fare and leaves unknown fares out", () => {
    const result = okResult([
      {
        flightNumber: "2046",
        departureTime: "10:17",
        arrivalTime: "11:58",
        stops: 0,
        segments: [],
        standard: { amount: 149, currency: "USD", seatsRemaining: null },
        discountDen: { amount: null, currency: null, seatsRemaining: null },
        goWild: { amount: 19.01, currency: "USD", seatsRemaining: 3 },
        otherFares: [],
      },
    ]);
    const history = priceHistoryFrom(result, "2026-09-27T12:00:00.000Z");
    expect(history.map((row) => [row.fareClass, row.amount, row.seatsRemaining])).toEqual([
      ["standard", 149, null],
      ["goWild", 19.01, 3],
    ]);
    expect(history.every((row) => row.source === "frontier_availability")).toBe(true);
    expect(new Set(history.map((row) => row.amount)).size).toBe(2);
  });

  it("does not call one miss discontinued", () => {
    const previous = okResult([
      {
        flightNumber: "2046",
        departureTime: "10:17",
        arrivalTime: "11:58",
        stops: 0,
        segments: [],
        standard: { amount: 149, currency: "USD", seatsRemaining: null },
        discountDen: { amount: null, currency: null, seatsRemaining: null },
        goWild: { amount: null, currency: null, seatsRemaining: null },
        otherFares: [],
      },
    ]);
    const event = availabilityRouteEvent(previous, okResult([]));
    expect(event.type).toBe("possible_gap");
    expect(event.detail.toLowerCase()).not.toContain("discontinued");
    expect(availabilityRouteEvent(null, { ...okResult([]), status: "blocked" }).type).toBe("blocked");
  });
});

describe("listed markets and Pages secrets", () => {
  it("does not let a listed market become an arc", () => {
    const network = buildNetwork({ flights: [], routes: [{ origin: "OAK", destination: "LAS", provenance: "listed" }] }, TODAY);
    expect(confirmedArcKeys(network, TODAY)).not.toContain("OAK|LAS");
  });

  it("rejects credential markers and finds none in the client sources", () => {
    expect(findForbiddenMarkers("frontiertoken")).toEqual(["frontiertoken"]);
    for (const file of ["site/app.js", "site/index.html", "site/styles.css", "src/site/availability/provider.ts"]) {
      expect(findForbiddenMarkers(readFileSync(file, "utf8")), file).toEqual([]);
    }
    expect(readFileSync("scripts/build-pages.mjs", "utf8")).toContain("assertNoCredentialMarkers");
  });
});

function searchWith(response: { status: number; contentType: string | null; body: string }) {
  return new FrontierAvailabilityProvider(async () => response).search(QUERY);
}

function okResult(flights: AvailabilitySearchResult["flights"]): AvailabilitySearchResult {
  return { status: "ok", origin: "OAK", destination: "LAS", date: "2026-09-28", httpStatus: 200, flights };
}
