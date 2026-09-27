import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterItineraries, searchPublished, type PublishedSchedule } from "@/site/published-search";

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

  it("hides the San Francisco to New York trip that runs past 8 hours", () => {
    const found = find({
      from: "SFO",
      to: ["JFK", "LGA", "EWR"],
      date: "2026-09-26",
      stops: { nonstop: true, one: true, two: true },
      excludeRedEyes: false,
    });
    const longTrip = found.itineraries.find((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === "1448"));
    expect(longTrip?.elapsedMinutes).toBeGreaterThanOrEqual(10 * 60);
    const capped = filterItineraries(found.itineraries, { maxElapsedMinutes: 8 * 60 });
    expect(capped.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === "1448"))).toBe(false);
    expect(capped.hidden.duration).toBe(found.itineraries.length);
    const restored = filterItineraries(found.itineraries, {});
    expect(restored.itineraries.some((itinerary) => itinerary.segments.some((segment) => segment.flightNumber === "1448"))).toBe(true);
    expect(restored.hidden.duration).toBe(0);
  });

  it("filters local departure, arrival, hub, and layover without dropping an open Las Vegas overnight", () => {
    const found = find({
      from: "SFO",
      to: ["JFK", "LGA", "EWR"],
      date: "2026-09-26",
      stops: { nonstop: true, one: true, two: true },
      excludeRedEyes: false,
    });
    const morningArrival = filterItineraries(found.itineraries, { arrivalWindow: "morning" });
    expect(morningArrival.itineraries.length).toBeGreaterThan(0);
    expect(morningArrival.itineraries.every((itinerary) => itinerary.segments.at(-1)?.arrivalLocal.includes("T11:50:00"))).toBe(true);
    const eveningDeparture = filterItineraries(found.itineraries, { departureWindow: "evening" });
    expect(eveningDeparture.itineraries.some((itinerary) => itinerary.segments[0]?.flightNumber === "1448")).toBe(false);
    const atlanta = filterItineraries(found.itineraries, { connectingAirport: "ATL" });
    expect(atlanta.itineraries.length).toBeGreaterThan(0);
    expect(atlanta.itineraries.every((itinerary) => itinerary.connections.some((connection) => connection.airport === "ATL"))).toBe(true);
    const lasVegas = filterItineraries(found.itineraries, { connectingAirport: "LAS" });
    expect(lasVegas.itineraries.every((itinerary) => itinerary.connections.some((connection) => connection.airport === "LAS"))).toBe(true);
    expect(lasVegas.itineraries.some((itinerary) => itinerary.segments[0]?.flightNumber === "1448")).toBe(false);

    const overnight = find({ from: "OAK", to: "LAX", date: "2026-10-15" }).itineraries.find((itinerary) => itinerary.vegasOvernight);
    expect(overnight).toBeTruthy();
    expect(filterItineraries(overnight ? [overnight] : [], {}).itineraries).toHaveLength(1);
    expect(filterItineraries(overnight ? [overnight] : [], { maxLayoverMinutes: 8 * 60 }).itineraries).toHaveLength(0);
  });

  it("rejects an impossible connection and keeps a normal Las Vegas connection", () => {
    const legs = [
      flight("OAK", "LAS", "1", "2026-10-15T10:00:00", "2026-10-15T11:20:00", "2026-10-15T17:00:00Z", "2026-10-15T18:20:00Z"),
      flight("LAS", "LAX", "2", "2026-10-15T11:50:00", "2026-10-15T13:05:00", "2026-10-15T18:50:00Z", "2026-10-15T20:05:00Z"),
      flight("LAS", "LAX", "3", "2026-10-15T12:50:00", "2026-10-15T14:05:00", "2026-10-15T19:50:00Z", "2026-10-15T21:05:00Z"),
    ];
    const result = searchPublished(legs, { from: "OAK", to: "LAX", date: "2026-10-15", excludeRedEyes: false });
    expect(result.itineraries).toHaveLength(1);
    expect(result.itineraries[0]?.segments[1]?.flightNumber).toBe("3");
    expect(result.itineraries[0]?.connections[0]?.kind).toBe("normal");
    expect(result.itineraries[0]?.connections[0]?.minutes).toBe(90);
  });

  it("labels a long layover and an overnight Las Vegas connection differently", () => {
    const legs = [
      flight("SFO", "LAS", "10", "2026-10-15T12:00:00", "2026-10-15T13:20:00", "2026-10-15T19:00:00Z", "2026-10-15T20:20:00Z"),
      flight("LAS", "BUR", "11", "2026-10-15T18:30:00", "2026-10-15T19:40:00", "2026-10-16T01:30:00Z", "2026-10-16T02:40:00Z"),
      flight("SFO", "LAS", "12", "2026-10-15T15:00:00", "2026-10-15T16:20:00", "2026-10-15T22:00:00Z", "2026-10-15T23:20:00Z"),
      flight("LAS", "BUR", "13", "2026-10-16T12:20:00", "2026-10-16T13:30:00", "2026-10-16T19:20:00Z", "2026-10-16T20:30:00Z"),
    ];
    const result = searchPublished(legs, { from: "SFO", to: "BUR", date: "2026-10-15", excludeRedEyes: false });
    const long = result.itineraries.find((item) => item.segments[1]?.flightNumber === "11");
    const overnight = result.itineraries.find((item) => item.segments[1]?.flightNumber === "13");
    expect(long?.connections[0]?.kind).toBe("long");
    expect(long?.connections[0]?.label).toMatch(/Long layover/);
    expect(overnight?.vegasOvernight).toBe(true);
    expect(overnight?.connections[0]?.kind).toBe("overnight");
    expect(overnight?.connectionLabel).toBe("Overnight in Las Vegas");
    expect(overnight?.elapsedMinutes).toBeGreaterThan(18 * 60);
    expect(overnight?.connections[0]?.label).not.toMatch(/min in LAS/);
  });

  it("keeps a 22:00 Las Vegas departure discoverable when red-eyes are included", () => {
    const legs = [
      flight("SFO", "LAS", "4402", "2026-10-15T22:19:00", "2026-10-15T23:44:00", "2026-10-16T05:19:00Z", "2026-10-16T06:44:00Z"),
    ];
    expect(searchPublished(legs, { from: "SFO", to: "LAS", date: "2026-10-15" }).itineraries).toHaveLength(0);
    expect(searchPublished(legs, { from: "SFO", to: "LAS", date: "2026-10-15" }).hiddenRedEyes).toBe(1);
    expect(searchPublished(legs, { from: "SFO", to: "LAS", date: "2026-10-15", excludeRedEyes: false }).itineraries).toHaveLength(1);
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
