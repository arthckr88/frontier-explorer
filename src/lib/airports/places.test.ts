import { describe, expect, it } from "vitest";
import { parseTripQuery } from "@/lib/airports/places";

describe("trip query parser", () => {
  it("parses airport codes", () => {
    const parsed = parseTripQuery("OAK → LAX", false);
    expect(parsed.origin).toMatchObject({ used: ["OAK"] });
    expect(parsed.destination).toMatchObject({ used: ["LAX"] });
  });

  it("maps Bay Area and LA to physical airports and keeps nearby optional", () => {
    const parsed = parseTripQuery("Bay Area → LA", false);
    expect(parsed.origin).toMatchObject({ primary: ["OAK", "SFO"], used: ["OAK", "SFO"] });
    expect(parsed.destination).toMatchObject({ primary: ["LAX", "BUR"], nearby: ["SNA", "ONT"] });
    const withNearby = parseTripQuery("Bay Area to LA", true);
    expect(withNearby.origin && withNearby.origin.kind === "airports" && withNearby.origin.used).toEqual([
      "OAK",
      "SFO",
      "SJC",
    ]);
  });

  it("maps New York to JFK and LGA, with EWR only as nearby", () => {
    const parsed = parseTripQuery("SFO → New York", false);
    expect(parsed.destination).toMatchObject({ primary: ["LGA", "JFK"], nearby: ["EWR"], used: ["LGA", "JFK"] });
  });

  it("maps Caribbean to a region rather than a fake airport", () => {
    const parsed = parseTripQuery("OAK → Caribbean", false);
    expect(parsed.destination).toMatchObject({ kind: "region", region: "caribbean" });
  });
});
