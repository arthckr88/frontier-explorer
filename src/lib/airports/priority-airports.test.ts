import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Airport = { iata: string; city: string; lat: number; lon: number; timezone: string };

const airports = JSON.parse(readFileSync(new URL("../../../data/airports.json", import.meta.url), "utf8")) as Airport[];

const expected: Record<string, { city: string; lat: number; lon: number }> = {
  OAK: { city: "Oakland", lat: 37.72, lon: -122.22 },
  SFO: { city: "San Francisco", lat: 37.62, lon: -122.37 },
  LAS: { city: "Las Vegas", lat: 36.08, lon: -115.15 },
  LAX: { city: "Los Angeles", lat: 33.94, lon: -118.41 },
  BUR: { city: "Burbank", lat: 34.2, lon: -118.36 },
  SAN: { city: "San Diego", lat: 32.73, lon: -117.19 },
  ONT: { city: "Ontario", lat: 34.06, lon: -117.6 },
  SNA: { city: "Santa Ana", lat: 33.68, lon: -117.87 },
};

describe("priority airport reference", () => {
  it("keeps coordinates, city, and the Pacific timezone", () => {
    for (const [code, want] of Object.entries(expected)) {
      const airport = airports.find((item) => item.iata === code);
      expect(airport, code).toBeTruthy();
      expect(airport?.city).toBe(want.city);
      expect(airport?.timezone).toBe("America/Los_Angeles");
      expect(airport?.lat).toBeCloseTo(want.lat, 1);
      expect(airport?.lon).toBeCloseTo(want.lon, 1);
    }
  });
});
