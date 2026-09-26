import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { searchPublished, type PublishedSchedule } from "@/site/published-search";

const published = JSON.parse(readFileSync(new URL("../../data/flights.json", import.meta.url), "utf8")) as PublishedSchedule;

function find(query: Parameters<typeof searchPublished>[1]) {
  return searchPublished(published.flights, query);
}

describe("published schedule search", () => {
  it("returns the stored Oakland to Las Vegas nonstops on 2026-10-15", () => {
    const results = find({ from: "oak", to: "las", date: "2026-10-15" }).itineraries;
    expect(results.map((result) => result.segments.map((segment) => segment.flightNumber))).toEqual([["2046"], ["3838"]]);
    expect(results.every((result) => result.stops === 0)).toBe(true);
    expect(results[0]?.segments[0]).toMatchObject({
      departureLocal: "2026-10-15T10:17:00",
      arrivalLocal: "2026-10-15T11:52:00",
    });
    expect(results[1]?.segments[0]).toMatchObject({
      departureLocal: "2026-10-15T17:20:00",
      arrivalLocal: "2026-10-15T18:55:00",
    });
  });

  it("labels an overnight Las Vegas connection from the stored flights", () => {
    const results = find({ from: "OAK", to: "LAX", date: "2026-10-15" }).itineraries;
    const overnight = results.find(
      (result) =>
        result.vegasOvernight &&
        result.segments[0]?.flightNumber === "3838" &&
        result.segments[1]?.flightNumber === "3291",
    );
    expect(overnight?.connectionLabel).toBe("Overnight in Las Vegas");
    expect(overnight?.segments[1]?.departureLocal).toBe("2026-10-16T06:15:00");
  });

  it("does not invent a flight on an empty day", () => {
    expect(find({ from: "OAK", to: "LAS", date: "2026-11-01" }).itineraries).toEqual([]);
  });

  it("builds a two-stop path and counts hidden red-eyes", () => {
    const legs = [
      flight("SFO", "DEN", "100", "2026-10-15T08:00:00", "2026-10-15T11:30:00", "2026-10-15T15:00:00Z", "2026-10-15T17:30:00Z"),
      flight("DEN", "DFW", "200", "2026-10-15T13:00:00", "2026-10-15T16:00:00", "2026-10-15T19:00:00Z", "2026-10-15T21:00:00Z"),
      flight("DFW", "JFK", "300", "2026-10-15T17:30:00", "2026-10-15T21:40:00", "2026-10-15T22:30:00Z", "2026-10-16T01:40:00Z"),
      flight("DFW", "JFK", "301", "2026-10-15T23:10:00", "2026-10-16T03:20:00", "2026-10-16T04:10:00Z", "2026-10-16T07:20:00Z"),
    ];
    const hidden = searchPublished(legs, { from: "SFO", to: "JFK", date: "2026-10-15" });
    expect(hidden.hiddenRedEyes).toBe(1);
    expect(hidden.itineraries.map((item) => item.segments.map((segment) => segment.flightNumber))).toEqual([["100", "200", "300"]]);
    expect(hidden.itineraries[0]?.stops).toBe(2);
    const shown = searchPublished(legs, { from: "SFO", to: "JFK", date: "2026-10-15", excludeRedEyes: false });
    expect(shown.itineraries).toHaveLength(2);
    expect(shown.itineraries.some((item) => item.hasRedEye)).toBe(true);
  });

  it("searches JFK and LGA together and keeps a Las Vegas overnight off the red-eye list", () => {
    const legs = [
      flight("SFO", "LAS", "10", "2026-10-15T18:00:00", "2026-10-15T19:30:00", "2026-10-16T01:00:00Z", "2026-10-16T02:30:00Z"),
      flight("LAS", "LGA", "11", "2026-10-16T08:00:00", "2026-10-16T16:10:00", "2026-10-16T15:00:00Z", "2026-10-16T20:10:00Z"),
    ];
    const result = searchPublished(legs, { from: "SFO", to: ["JFK", "LGA"], date: "2026-10-15" });
    expect(result.hiddenRedEyes).toBe(0);
    expect(result.itineraries[0]?.vegasOvernight).toBe(true);
    expect(result.itineraries[0]?.connectionLabel).toBe("Overnight in Las Vegas");
    expect(result.itineraries[0]?.segments[1]?.destination).toBe("LGA");
  });
});

function flight(
  origin: string,
  destination: string,
  flightNumber: string,
  departureLocal: string,
  arrivalLocal: string,
  departureUtc: string,
  arrivalUtc: string,
) {
  return { origin, destination, flightNumber, date: departureLocal.slice(0, 10), departureLocal, arrivalLocal, departureUtc, arrivalUtc };
}
