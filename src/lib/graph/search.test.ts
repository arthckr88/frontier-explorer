import { describe, expect, it } from "vitest";
import { searchItineraries, type FlightSegment, type SearchQuery } from "@/lib/graph/search";

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    origins: ["OAK"],
    destinations: ["LAX"],
    date: "2026-10-01",
    maxStops: 1,
    minConnectionMinutes: 60,
    allowLongConnection: true,
    allowIntentionalStopover: true,
    allowMultiDay: false,
    excludeRedEyes: true,
    maxJourneyHours: 36,
    preferVegasStopover: true,
    preferredOrigins: ["OAK", "SFO"],
    preferredDestinations: ["LAX", "BUR"],
    ...overrides,
  };
}

const vegasOvernight: FlightSegment[] = [
  {
    id: "oak-las",
    origin: "OAK",
    destination: "LAS",
    departureLocal: "2026-10-01T19:00:00",
    arrivalLocal: "2026-10-01T20:30:00",
    originTimezone: "America/Los_Angeles",
    destinationTimezone: "America/Los_Angeles",
    frequencyPerWeek: 7,
  },
  {
    id: "las-lax",
    origin: "LAS",
    destination: "LAX",
    departureLocal: "2026-10-02T11:00:00",
    arrivalLocal: "2026-10-02T12:10:00",
    originTimezone: "America/Los_Angeles",
    destinationTimezone: "America/Los_Angeles",
    frequencyPerWeek: 7,
  },
];

const redEye: FlightSegment = {
  id: "oak-atl",
  origin: "OAK",
  destination: "ATL",
  departureLocal: "2026-10-01T23:55:00",
  arrivalLocal: "2026-10-02T07:10:00",
  originTimezone: "America/Los_Angeles",
  destinationTimezone: "America/New_York",
};

const awkwardSameDay: FlightSegment[] = [
  {
    id: "oak-den",
    origin: "OAK",
    destination: "DEN",
    departureLocal: "2026-10-01T06:10:00",
    arrivalLocal: "2026-10-01T09:40:00",
    originTimezone: "America/Los_Angeles",
    destinationTimezone: "America/Denver",
    frequencyPerWeek: 7,
  },
  {
    id: "den-lax",
    origin: "DEN",
    destination: "LAX",
    departureLocal: "2026-10-01T10:50:00",
    arrivalLocal: "2026-10-01T12:05:00",
    originTimezone: "America/Denver",
    destinationTimezone: "America/Los_Angeles",
    frequencyPerWeek: 7,
  },
];

describe("itinerary search", () => {
  it("excludes an overnight airborne red-eye and keeps an overnight Las Vegas hotel connection", () => {
    const flights = [...vegasOvernight, redEye];
    const hidden = searchItineraries(flights, query({ destinations: ["LAX", "ATL"] }));
    expect(hidden.map((itinerary) => itinerary.id)).toContain("oak-las>las-lax");
    expect(hidden.map((itinerary) => itinerary.id)).not.toContain("oak-atl");
    const vegas = hidden.find((itinerary) => itinerary.id === "oak-las>las-lax");
    expect(vegas?.connections[0]?.label).toBe("Overnight in Las Vegas");
    expect(vegas?.hasRedEye).toBe(false);

    const shown = searchItineraries(flights, query({ destinations: ["ATL"], excludeRedEyes: false, origins: ["OAK"] }));
    expect(shown[0]?.hasRedEye).toBe(true);
  });

  it("does not rank the Las Vegas overnight below an awkward same-day trip", () => {
    const ranked = searchItineraries([...vegasOvernight, ...awkwardSameDay], query());
    expect(ranked[0]?.id).toBe("oak-las>las-lax");
    expect(ranked[0]?.factors.some((factor) => factor.label === "Overnight in Las Vegas")).toBe(true);
  });

  it("rejects an impossible connection and keeps a valid one", () => {
    const tooShort: FlightSegment[] = [
      {
        id: "mco-jfk-short",
        origin: "MCO",
        destination: "JFK",
        departureLocal: "2026-06-15T12:00:00",
        arrivalLocal: "2026-06-15T15:00:00",
        originTimezone: "America/New_York",
        destinationTimezone: "America/New_York",
      },
      {
        id: "jfk-bos-short",
        origin: "JFK",
        destination: "BOS",
        departureLocal: "2026-06-15T15:30:00",
        arrivalLocal: "2026-06-15T16:45:00",
        originTimezone: "America/New_York",
        destinationTimezone: "America/New_York",
      },
    ];
    const valid: FlightSegment[] = [
      tooShort[0] as FlightSegment,
      {
        id: "jfk-bos-valid",
        origin: "JFK",
        destination: "BOS",
        departureLocal: "2026-06-15T16:30:00",
        arrivalLocal: "2026-06-15T17:45:00",
        originTimezone: "America/New_York",
        destinationTimezone: "America/New_York",
      },
    ];
    const options = query({
      origins: ["MCO"],
      destinations: ["BOS"],
      date: "2026-06-15",
      preferredOrigins: ["MCO"],
      preferredDestinations: ["BOS"],
    });
    expect(searchItineraries(tooShort, options)).toHaveLength(0);
    expect(searchItineraries(valid, options)).toHaveLength(1);
  });

  it("uses absolute time across the March daylight-saving change", () => {
    const base = query({
      origins: ["MCO"],
      destinations: ["BOS"],
      date: "2026-03-07",
      excludeRedEyes: false,
      minConnectionMinutes: 90,
      preferredOrigins: [],
      preferredDestinations: [],
    });
    const arrival = {
      id: "into-jfk",
      origin: "MCO",
      destination: "JFK",
      departureLocal: "2026-03-07T21:00:00",
      arrivalLocal: "2026-03-08T01:30:00",
      originTimezone: "America/New_York",
      destinationTimezone: "America/New_York",
    };
    const tooShort = searchItineraries(
      [
        arrival,
        {
          id: "out-short",
          origin: "JFK",
          destination: "BOS",
          departureLocal: "2026-03-08T03:30:00",
          arrivalLocal: "2026-03-08T04:45:00",
          originTimezone: "America/New_York",
          destinationTimezone: "America/New_York",
        },
      ],
      base,
    );
    expect(tooShort).toHaveLength(0);

    const valid = searchItineraries(
      [
        { ...arrival, arrivalLocal: "2026-03-08T01:00:00" },
        {
          id: "out-valid",
          origin: "JFK",
          destination: "BOS",
          departureLocal: "2026-03-08T04:00:00",
          arrivalLocal: "2026-03-08T05:15:00",
          originTimezone: "America/New_York",
          destinationTimezone: "America/New_York",
        },
      ],
      base,
    );
    expect(valid).toHaveLength(1);
    expect(valid[0]?.connections[0]?.minutes).toBe(120);
  });

  it("does not invent a return just because the outbound flight exists", () => {
    const results = searchItineraries(vegasOvernight, query({ origins: ["LAS"], destinations: ["OAK"], date: "2026-10-01" }));
    expect(results).toHaveLength(0);
  });

  it("reports cross-country elapsed time in absolute minutes", () => {
    const [itinerary] = searchItineraries(
      [
        {
          id: "oak-jfk",
          origin: "OAK",
          destination: "JFK",
          departureLocal: "2026-06-15T08:00:00",
          arrivalLocal: "2026-06-15T16:30:00",
          originTimezone: "America/Los_Angeles",
          destinationTimezone: "America/New_York",
        },
      ],
      query({ destinations: ["JFK"], date: "2026-06-15", preferredDestinations: ["JFK"] }),
    );
    expect(itinerary?.elapsedMinutes).toBe(330);
  });
});
