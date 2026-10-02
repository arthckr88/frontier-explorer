import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasNonstopEvidence } from "@/site/direct-routes";
import { parsePdxDepartures, parsePdxRoutes } from "@/site/airport-sources";
import { loadCatalog } from "@/static/load";
import { dateStatus, DEFAULT_SETTINGS, EMPTY_QUERY, flightDates, flightResults } from "@/static/search";
import { staticDiscover, staticNetworkAdapter } from "@/static/adapter";
import { FlightResults } from "@/views/flight-results";

const checked = "2026-10-02T22:00:00Z";
const route = (code: string, carrier = "F9", active = true) => ({ IsActive: active, IsSeasonal: code === "DEN", Airline: { IataCode: carrier }, Destination: { Code: code, City: code } });
const routesHtml = `NonstopDestinations: ${JSON.stringify([route("LAS"), route("DEN"), route("OAK", "AS"), route("SFO", "F9", false)])},\n`;
const parsed = parsePdxRoutes(routesHtml, checked);
const flight = (patch = {}) => ({ CarrierCode: "F9", ScheduleType: "D", Cities: [{ Code: "LAS" }], ScheduledTime: "2026-10-03T12:24:00", FlightNo: 1106, StatusCode: "ON", ...patch });

describe("official airport sources", () => {
  it("uses active airline-specific nonstops and preserves seasonality", () => {
    expect(parsed.map((item) => item.destination)).toEqual(["DEN", "LAS"]);
    expect(parsed.find((item) => item.destination === "DEN")?.seasonal).toBe(true);
    expect(parsed.every(hasNonstopEvidence)).toBe(true);
    expect(hasNonstopEvidence({ ...parsed[0]!, origin: "OAK" })).toBe(false);
    expect(() => parsePdxRoutes("Challenge page", checked)).toThrow(/preserved/);
  });
  it("keeps only valid Frontier departures on listed nonstops and never creates arrivals", () => {
    const html = `Flights: ${JSON.stringify([flight(), flight({ ScheduleType: "A" }), flight({ CarrierCode: "AS" }), flight({ StatusCode: "CX" }), flight({ Cities: [{ Code: "LAS" }, { Code: "MCO" }] }), flight({ Cities: [{ Code: "PDX" }] }), flight({ ScheduledTime: "2026-02-30T12:24:00" })])},\n`;
    const departures = parsePdxDepartures(html, parsed, checked);
    expect(departures).toHaveLength(1);
    expect(departures[0]).toMatchObject({ destination: "LAS", date: "2026-10-03", flightNumber: "1106" });
    expect(departures[0]).not.toHaveProperty("arrivalLocal");
    expect(departures[0]).not.toHaveProperty("durationMinutes");
  });
});

describe("PDX exploration and flight search", () => {
  const catalog = loadCatalog();
  const explore = { ...EMPTY_QUERY, origin: "PDX" };
  const render = (query = explore) => renderToStaticMarkup(createElement(FlightResults, { catalog, query, selectedId: null, onSelect: () => {}, onSearch: () => {}, settings: DEFAULT_SETTINGS }));
  it("shows actual PDX destinations in both results and the map", () => {
    expect(staticDiscover(catalog, "PDX", 0).groups[0]?.items.map((item) => item.iata)).toEqual(["DEN", "LAS", "LAX"]);
    expect(staticNetworkAdapter(catalog).routes.filter((item) => item.origin === "PDX").map((item) => item.destination).sort()).toEqual(["DEN", "LAS", "LAX"]);
    const html = render();
    expect(html).toContain("Explore PDX to LAS");
    expect(html).toContain("Seasonal service");
    expect(html).toContain("Portland airport");
    expect(html).not.toContain("Explore PDX to OAK");
  });
  it("shows a real dated departure without inventing an arrival or a connection", () => {
    const query = { ...explore, destination: "LAS", date: "2026-10-03" };
    const result = flightResults(catalog, query);
    expect(result.flights).toEqual([]);
    expect(result.departures).toMatchObject([{ flightNumber: "1106", departureLocal: "2026-10-03T12:24:00" }]);
    expect(dateStatus(catalog, query)).toBe("departure_only");
    expect(flightDates(catalog, query)).toContain("2026-10-03");
    expect(render(query)).toContain("F9 1106");
    expect(render(query)).toContain("Arrival time and price unavailable");
    expect(flightResults(catalog, { ...query, maxDuration: 180 }).departures).toEqual([]);
    expect(flightResults(catalog, { ...query, arrive: "afternoon" }).departures).toEqual([]);
    expect(flightResults(catalog, { ...query, destination: "MCO", maxStops: 1 }).flights).toEqual([]);
  });
  it("gives unimported airports an explanation and a route lookup instead of a blank section", () => {
    const html = render({ ...explore, origin: "RDU" });
    expect(html).toContain("aren’t available in this app");
    expect(html).toContain("Check Frontier’s full route map");
    expect(html).not.toContain("Nonstop destinations");
  });
});
