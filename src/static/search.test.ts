import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/static/load";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FlightResults } from "@/views/flight-results";
import { dateStatus, EMPTY_QUERY, flightResults, flightDates, parseSearchQuery, searchUrl, resolveAirport, scheduleSourceUrl } from "@/static/search";
const catalog = loadCatalog();
const query = { ...EMPTY_QUERY, origin: "OAK", destination: "LAX", date: "2026-09-28", maxStops: 1, excludeRedEyes: false };
describe("usable flight search", () => {
  it("applies duration and local departure/arrival filters to full connecting trips", () => {
    const all = flightResults(catalog, query).flights;
    expect(all.map((flight) => flight.durationMinutes)).toContain(507);
    const shorter = flightResults(catalog, { ...query, maxDuration: 300 }).flights;
    expect(shorter.map((flight) => flight.durationMinutes)).toEqual([284]);
    expect(shorter[0]?.segments?.map((leg) => leg.flightNumber)).toEqual(["2046", "2263"]);
    expect(shorter[0]?.connections?.[0]?.airport).toBe("LAS");
    const afternoon = flightResults(catalog, { ...query, arrive: "afternoon" }).flights;
    expect(afternoon.every((flight) => Number(flight.arrivalLocal.slice(11,13)) >= 12 && Number(flight.arrivalLocal.slice(11,13)) < 17)).toBe(true);
    const evening = flightResults(catalog, { ...query, depart: "evening" }).flights;
    expect(evening.length).toBeGreaterThan(0);
    expect(evening.every((flight) => Number(flight.departureLocal.slice(11,13)) >= 17 && Number(flight.departureLocal.slice(11,13)) < 22)).toBe(true);
  });
  it("sorts connections by total duration and excludes incomplete old fare rows", () => {
    const flights = flightResults(catalog, { ...query, sort: "duration" }).flights;
    expect(flights.length).toBeGreaterThan(0);
    expect(flights.every((flight) => !flight.legacyPartial && flight.segments?.length === flight.stops + 1)).toBe(true);
    expect(flights.map((flight) => flight.durationMinutes)).toEqual([...flights.map((flight) => flight.durationMinutes)].sort((a,b)=>a-b));
    expect(flightResults(catalog, { ...query, via: "OAK" }).flights).toEqual([]);
  });
  it("keeps dates and prices tied to their exact flight date", () => {
    const october = flightResults(catalog, { ...query, destination: "LAS", date: "2026-10-23", maxStops: 0 }).flights;
    expect(october).toHaveLength(2);
    expect(october.every((flight) => !flight.standard && !flight.goWild && !flight.discountDen)).toBe(true);
    expect(flightDates(catalog, { ...query, destination: "LAS", maxStops: 0 })).toContain("2026-10-23");
    expect(flightResults(catalog, { ...query, destination: "LAS", date: "2026-10-02", maxStops: 0 }).flights).toEqual([]);
  });
  it("finds next-day connecting legs and applies red-eye exclusion per leg", () => {
    const observation = catalog.network.observations[0]!;
    const synthetic = { ...catalog, fares: [], network: { ...catalog.network, observations: [
      { ...observation, origin: "OAK", destination: "LAS", date: "2026-10-22", flightNumber: "1", departureLocal: "2026-10-22T21:00:00", arrivalLocal: "2026-10-22T22:00:00", departureUtc: "2026-10-23T04:00:00Z", arrivalUtc: "2026-10-23T05:00:00Z" },
      { ...observation, origin: "LAS", destination: "LAX", date: "2026-10-23", flightNumber: "2", departureLocal: "2026-10-23T00:00:00", arrivalLocal: "2026-10-23T01:00:00", departureUtc: "2026-10-23T07:00:00Z", arrivalUtc: "2026-10-23T08:00:00Z" },
    ] } };
    const overnight = { ...query, date: "2026-10-22" };
    const flights = flightResults(synthetic, overnight).flights;
    expect(flights).toHaveLength(1);
    expect(flights[0]?.durationMinutes).toBe(240);
    expect(flights[0]?.connections).toMatchObject([{ airport: "LAS", minutes: 120 }]);
    expect(flightResults(synthetic, { ...overnight, excludeRedEyes: true }).flights).toHaveLength(0);
    expect(dateStatus(synthetic, { ...overnight, maxDuration: 100 })).toBe("captured");
  });
  it("does not claim OAK–PDX is a Frontier nonstop when the schedule is unknown", () => {
    const q = { ...EMPTY_QUERY, origin: "OAK", destination: "PDX", date: "2026-10-02" };
    expect(flightResults(catalog, q).officialNonstop).toBe(false);
    expect(flightResults(catalog, q).flights).toEqual([]);
    expect(dateStatus(catalog, q)).toBe("missing");
    const html = renderToStaticMarkup(createElement(FlightResults, { catalog, query: q, selectedId: null, onSelect: () => {}, onSearch: () => {}, settings: { fareMode: "standard", excludeRedEyes: true, maxStops: 0 } }));
    expect(html).toContain("Schedule unavailable");
    expect(html).not.toContain("0 flight options");
    expect(html).not.toContain("Frontier lists this as a nonstop route");
    expect(html).toContain("Include connections");
  });
  it("round trips all search filters through a shareable URL", () => {
    const original = { ...query, maxDuration: 300, sort: "duration" as const, depart: "morning" as const, arrive: "afternoon" as const, via: "LAS", layover: "normal" as const };
    expect(parseSearchQuery(new URL(searchUrl(original), "https://example.test").searchParams)).toEqual(original);
    expect(parseSearchQuery(new URLSearchParams("from=DEN&to=MCO&date=2026-02-30"))).toBeNull();
    expect(parseSearchQuery(new URLSearchParams("from=DEN"))?.date).toBe("");
    expect(resolveAirport(catalog, "Denver")).toBe("DEN");
    expect(resolveAirport(catalog, "xyz")).toBe("");
  });
  it("offers free timetable links across the official route network without inventing flight times", () => {
    for (const route of catalog.network.official?.routes ?? []) expect(scheduleSourceUrl(route.origin,route.destination)).toMatch(/^https:\/\/www.flightconnections.com\/flights-from-[a-z]{3}-to-[a-z]{3}#F9$/);
    expect(scheduleSourceUrl("DEN", "MCO")).toBe("https://www.flightconnections.com/flights-from-den-to-mco#F9");
  });
});
