import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { cachePath, fareTtlMs, selectCached, writeCache } from "@/site/browser/cache";
import { bookingDisplayDate, parseBrowserArgs } from "@/site/browser/form";
import { appendPriceHistory, priceObservationsFrom } from "@/site/browser/history";
import { mergeBrowserNonstops, publishableFares } from "@/site/browser/integrate";
import { classifyBookingPage, displayDollars, normalizeFlightData } from "@/site/browser/parse";
import { runBrowserQueue } from "@/site/browser/queue";
import { sanitizeBrowserResult, sanitizeMarkets, stripSecretKeys } from "@/site/browser/sanitize";
import type { BrowserResult } from "@/site/browser/types";
import { buildNetwork, confirmedArcKeys, normalizeObservations } from "@/site/network";

const require = createRequire(import.meta.url);
const { findForbiddenMarkers } = require("../../../scripts/pages-secret-scan.mjs") as {
  findForbiddenMarkers: (text: string) => string[];
};

const QUERY = { origin: "OAK", destination: "LAS", date: "2026-09-28" };
const TODAY = "2026-09-27";

describe("FlightData fare parser", () => {
  it("keeps both nonstops, cents, rounded display dollars, and a missing fare", () => {
    const html = resultsPage({
      journeys: [
        {
          flights: [
            itinerary("2046", "2026-09-28T10:17:00", "2026-09-28T11:58:00", { standardFare: 50.98, discountDenFare: 49.98, goWildFare: 15.41 }),
            itinerary("3838", "2026-09-28T18:51:00", "2026-09-28T20:32:00", { standardFare: 50.98, discountDenFare: 49.98 }),
            {
              stopCount: 1,
              standardFare: 120.5,
              legs: [
                leg("100", "OAK", "DEN", "2026-09-28T08:00:00", "2026-09-28T11:30:00"),
                leg("200", "DEN", "LAS", "2026-09-28T13:00:00", "2026-09-28T14:10:00"),
              ],
            },
          ],
        },
      ],
    });
    const parsed = classifyBookingPage({ url: SELECT_URL, html, httpStatus: 200 }, QUERY, "2026-09-27T19:00:00.000Z");
    expect(parsed.status).toBe("ok");
    expect(parsed.source).toBe("frontier_browser");
    expect(parsed.flights.map((flight) => flight.flightNumber)).toEqual(["2046", "3838", "100"]);
    const first = parsed.flights[0];
    expect(first?.departureLocal).toBe("2026-09-28T10:17:00");
    expect(first?.arrivalLocal).toBe("2026-09-28T11:58:00");
    expect(first?.durationMinutes).toBe(101);
    expect(first?.stops).toBe(0);
    expect(first?.fares.standard).toEqual({ available: true, total: 50.98, display: 51, currency: null });
    expect(first?.fares.discountDen).toEqual({ available: true, total: 49.98, display: 50, currency: null });
    expect(first?.fares.goWild).toEqual({ available: true, total: 15.41, display: 16, currency: null });
    expect(first?.seatsRemaining).toBeNull();
    expect(parsed.flights[1]?.fares.goWild).toBeNull();
    expect(parsed.flights[2]?.stops).toBe(1);
    expect(parsed.flights[2]?.arrivalLocal).toBe("2026-09-28T14:10:00");
    expect(displayDollars(15.41)).toBe(16);
    expect(displayDollars(50.98)).toBe(51);
  });

  it("reads seats only when FlightData has them", () => {
    const normalized = normalizeFlightData(
      { journeys: [{ flights: [itinerary("2046", "2026-09-28T10:17:00", "2026-09-28T11:58:00", { standardFare: 50.98, seatsRemaining: 4 })] }] },
      QUERY,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.flights[0]?.seatsRemaining).toBe(4);
  });

  it("treats an explicit empty result as no flights and a broken assignment as parse_error", () => {
    const empty = classifyBookingPage(
      { url: SELECT_URL, html: resultsPage({ journeys: [{ flights: [] }] }), httpStatus: 200 },
      QUERY,
      "2026-09-27T19:00:00.000Z",
    );
    expect(empty.status).toBe("no_flights");
    expect(empty.flights).toEqual([]);
    const textOnly = classifyBookingPage(
      { url: SELECT_URL, html: "<html><p>There are no flights available for the day you selected.</p></html>", httpStatus: 200 },
      QUERY,
      "2026-09-27T19:00:00.000Z",
    );
    expect(textOnly.status).toBe("no_flights");
    const broken = classifyBookingPage(
      { url: SELECT_URL, html: "<html><script>FlightData = '{';</script></html>", httpStatus: 200 },
      QUERY,
      "2026-09-27T19:00:00.000Z",
    );
    expect(broken.status).toBe("parse_error");
  });

  it("does not turn a block or a homepage redirect into no flights", () => {
    expect(classifyBookingPage({ url: SELECT_URL, html: "", httpStatus: 406 }, QUERY, "2026-09-27T19:00:00.000Z").status).toBe("blocked");
    expect(classifyBookingPage({ url: SELECT_URL, html: "access denied", httpStatus: 403 }, QUERY, "2026-09-27T19:00:00.000Z").status).toBe("blocked");
    expect(classifyBookingPage({ url: "https://www.flyfrontier.com/", html: "<html>no flights available</html>", httpStatus: 200 }, QUERY, "2026-09-27T19:00:00.000Z").status).toBe("blocked");
    expect(classifyBookingPage({ url: "https://www.flyfrontier.com/", html: "<html>px-captcha</html>", httpStatus: 200 }, QUERY, "2026-09-27T19:00:00.000Z").status).toBe("blocked");
    expect(classifyBookingPage({ url: "https://www.flyfrontier.com/", html: "<html>form</html>", httpStatus: 200 }, QUERY, "2026-09-27T19:00:00.000Z").status).toBe("blocked");
  });
});

describe("browser cache and queue", () => {
  it("uses a fresh cache and ignores it when force is set", () => {
    const directory = mkdtempSync(join(tmpdir(), "frontier-browser-"));
    const now = new Date("2026-09-27T19:00:00.000Z");
    const result = okResult();
    writeCache(cachePath(directory, QUERY), result, now, TODAY, "USD");
    const saved = JSON.parse(readFileSync(cachePath(directory, QUERY), "utf8")) as BrowserResult;
    const fresh = selectCached(false, { ...result, retrievedAt: now.toISOString() }, new Date(now.getTime() + 5 * 60 * 1000), TODAY);
    const forced = selectCached(true, { ...result, retrievedAt: now.toISOString() }, new Date(now.getTime() + 5 * 60 * 1000), TODAY);
    const stale = selectCached(false, { ...result, retrievedAt: now.toISOString() }, new Date(now.getTime() + 11 * 60 * 1000), TODAY);
    expect(fresh?.flights[0]?.fares.goWild?.total).toBe(15.41);
    expect(saved.flights[0]?.fares.goWild?.currency).toBe("USD");
    expect(forced).toBeNull();
    expect(stale).toBeNull();
    expect(fareTtlMs("2026-09-28", TODAY)).toBe(10 * 60 * 1000);
    expect(fareTtlMs("2026-10-28", TODAY)).toBe(20 * 60 * 1000);
    expect(saved.source).toBe("frontier_browser");
    expect(findForbiddenMarkers(JSON.stringify(saved))).toEqual([]);
  });

  it("pauses between searches and stops when one is blocked", async () => {
    const pauses: number[] = [];
    const seen: string[] = [];
    const results = await runBrowserQueue(
      [
        QUERY,
        { origin: "SFO", destination: "LAX", date: "2026-09-28" },
        { origin: "SAN", destination: "LAS", date: "2026-09-28" },
      ],
      async (query) => {
        seen.push(query.origin);
        return query.origin === "SFO" ? { ...okResult(), status: "blocked", query, flights: [] } : { ...okResult(), query };
      },
      async (ms) => {
        pauses.push(ms);
      },
      15_000,
    );
    expect(seen).toEqual(["OAK", "SFO"]);
    expect(pauses).toEqual([15_000]);
    expect(results.map((result) => result.status)).toEqual(["ok", "blocked"]);
    await expect(runBrowserQueue(Array.from({ length: 6 }, () => QUERY), async () => okResult())).rejects.toThrow(/5/);
  });

  it("parses one search from the command and formats the calendar label", () => {
    expect(parseBrowserArgs(["--origin", "oak", "--destination", "las", "--date", "2026-09-28"])).toEqual({
      queries: [QUERY],
      force: false,
      queue: false,
    });
    expect(parseBrowserArgs(["--origin", "OAK", "--destination", "LAS", "--date", "2026-09-28", "--force"]).force).toBe(true);
    expect(bookingDisplayDate("2026-09-28")).toBe("Sep 28, 2026");
  });
});

describe("browser observations stay beside booking evidence", () => {
  it("drops a negative fare, keeps an existing booking flight, and does not add a connection", () => {
    const unavailable = classifyBookingPage(
      {
        url: SELECT_URL,
        html: resultsPage({
          journeys: [
            {
              flights: [
                {
                  stopCount: 0,
                  standardFare: 169.98,
                  goWildFare: -1,
                  legs: [leg("3308", "SFO", "LAX", "2026-09-28T09:00:00", "2026-09-28T10:37:00")],
                },
                {
                  stopCount: 1,
                  standardFare: 174.98,
                  legs: [
                    leg("1230", "SFO", "DEN", "2026-09-28T06:04:00", "2026-09-28T09:00:00"),
                    leg("200", "DEN", "LAX", "2026-09-28T12:00:00", "2026-09-28T14:39:00"),
                  ],
                },
              ],
            },
          ],
        }),
        httpStatus: 200,
      },
      { origin: "SFO", destination: "LAX", date: "2026-09-28" },
      "2026-09-27T22:54:31.514Z",
    );
    expect(unavailable.flights[0]?.fares.goWild).toBeNull();
    expect(unavailable.flights[0]?.fares.standard?.total).toBe(169.98);
    const booking = {
      origin: "SFO",
      destination: "LAX",
      flightNumber: "3308",
      date: "2026-09-28",
      departureLocal: "2026-09-28T09:00:00",
      arrivalLocal: "2026-09-28T10:37:00",
      departureUtc: "2026-09-28T16:00:00Z",
      arrivalUtc: "2026-09-28T17:37:00Z",
      provenance: "frontier_booking" as const,
    };
    const merged = mergeBrowserNonstops({ flights: [booking], routes: [{ origin: "OAK", destination: "BUR", provenance: "listed" }] }, [unavailable, { ...okResult(), status: "blocked", flights: [] }]);
    expect(merged.flights).toEqual([booking]);
    const fares = publishableFares([unavailable]);
    expect(fares.some((fare) => fare.stops !== 0)).toBe(true);
    expect(fares.some((fare) => fare.goWild)).toBe(false);
    const network = buildNetwork(
      { ...merged, browserFares: fares, routes: [{ origin: "OAK", destination: "BUR", provenance: "listed" }] },
      TODAY,
    );
    expect(confirmedArcKeys(network, TODAY)).not.toContain("OAK|BUR");
    expect(network.observations.some((flight) => flight.provenance === "frontier_browser")).toBe(false);
    const added = mergeBrowserNonstops({ flights: [] }, [unavailable]);
    expect(added.flights).toHaveLength(1);
    expect(added.flights?.[0]?.provenance).toBe("frontier_browser");
    expect(normalizeObservations(added, null)[0]?.source).toBe("Frontier browser fare check");
    expect(network.fares?.[0]?.source).toBe("frontier_browser");
  });
});

describe("price history", () => {
  it("appends fare observations and does not overwrite an older line", () => {
    const directory = mkdtempSync(join(tmpdir(), "frontier-prices-"));
    const file = join(directory, "price-history.jsonl");
    writeFileSync(file, `${JSON.stringify({ origin: "OAK", destination: "LAS", date: "2026-09-01", flightNumber: "1", departureLocal: "2026-09-01T10:00:00", fareType: "standard", price: 10, observedAt: "2026-09-01T00:00:00.000Z" })}\n`);
    const rows = priceObservationsFrom(okResult());
    expect(rows.map((row) => [row.fareType, row.price])).toEqual([
      ["standard", 50.98],
      ["discountDen", 49.98],
      ["goWild", 15.41],
    ]);
    appendPriceHistory(file, rows);
    appendPriceHistory(file, rows);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("2026-09-01");
    expect(JSON.parse(lines[3]).price).toBe(15.41);
    const search = readFileSync("src/views/search-panel.tsx", "utf8");
    expect(search).toContain("GoWild");
    expect(search).toContain("Source: Frontier.");
    expect(search).not.toContain("seats remaining");
  });
});

describe("listed markets and secret stripping", () => {
  it("does not let a market list become a confirmed nonstop", () => {
    const markets = sanitizeMarkets(
      { markets: [{ fromStation: "OAK", toStations: ["BUR", "LAS"] }] },
      "2026-09-27T19:00:00.000Z",
      "2026-09-28T07:00:00.000Z",
    );
    const routes = markets.markets.flatMap((market) => market.to.map((destination) => ({ origin: market.from, destination, provenance: "listed" as const })));
    const network = buildNetwork({ flights: [], routes }, TODAY);
    expect(confirmedArcKeys(network, TODAY)).not.toContain("OAK|BUR");
    expect(confirmedArcKeys(network, TODAY)).not.toContain("OAK|LAS");
    expect(markets.source).toBe("frontier_browser_markets");
  });

  it("drops cookies, tokens, and device ids before anything is stored", () => {
    const dirty = {
      ...okResult(),
      cookie: "session=secret",
      "set-cookie": "a=b",
      frontiertoken: "nope",
      "device-id": "nope",
      "x-px-authorization": "nope",
    };
    const clean = sanitizeBrowserResult(stripSecretKeys(dirty) as BrowserResult, "USD");
    const serialized = JSON.stringify(clean);
    expect(serialized).not.toMatch(/cookie|frontiertoken|device-id|x-px-|session=secret/i);
    expect(findForbiddenMarkers(serialized)).toEqual([]);
    expect(clean.flights[0]?.fares.standard?.total).toBe(50.98);
    expect(clean.source).toBe("frontier_browser");
  });
});

const SELECT_URL = "https://booking.flyfrontier.com/Flight/Select";

function resultsPage(data: unknown) {
  const encoded = JSON.stringify(data).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<html><script>FlightData = '${encoded}';</script></html>`;
}

function itinerary(
  flightNumber: string,
  departureDate: string,
  arrivalDate: string,
  extra: Record<string, unknown>,
) {
  return {
    stopCount: 0,
    ...extra,
    legs: [leg(flightNumber, "OAK", "LAS", departureDate, arrivalDate)],
  };
}

function leg(flightNumber: string, origin: string, destination: string, departureDate: string, arrivalDate: string) {
  return {
    carrierCode: "F9",
    flightNumber: Number(flightNumber),
    departureStation: origin,
    arrivalStation: destination,
    departureDate,
    arrivalDate,
  };
}

function okResult(): BrowserResult {
  return classifyBookingPage(
    {
      url: SELECT_URL,
      html: resultsPage({
        journeys: [{ flights: [itinerary("2046", "2026-09-28T10:17:00", "2026-09-28T11:58:00", { standardFare: 50.98, discountDenFare: 49.98, goWildFare: 15.41 })] }],
      }),
      httpStatus: 200,
    },
    QUERY,
    "2026-09-27T19:00:00.000Z",
  );
}
