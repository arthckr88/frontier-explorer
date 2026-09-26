import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { searchPublished, type PublishedSchedule } from "@/site/published-search";

const published = JSON.parse(readFileSync(new URL("../../data/flights.json", import.meta.url), "utf8")) as PublishedSchedule;

describe("published schedule search", () => {
  it("returns the stored Oakland to Las Vegas nonstops on 2026-10-15", () => {
    const results = searchPublished(published.flights, { from: "oak", to: "las", date: "2026-10-15" });
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
    const results = searchPublished(published.flights, { from: "OAK", to: "LAX", date: "2026-10-15" });
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
    expect(searchPublished(published.flights, { from: "OAK", to: "LAS", date: "2026-11-01" })).toEqual([]);
  });
});
