import { describe, expect, it } from "vitest";
import { legsForSearch, selectSearchHubs } from "@/server/search/hubs";

describe("selectSearchHubs", () => {
  const edges = [
    { origin: "OAK", destination: "LAS" },
    { origin: "LAS", destination: "MCO" },
    { origin: "OAK", destination: "DEN" },
    { origin: "DEN", destination: "MCO" },
    { origin: "OAK", destination: "PHX" },
    { origin: "SFO", destination: "DEN" },
  ];

  it("keeps hubs that already connect both ends and puts Las Vegas first", () => {
    expect(selectSearchHubs(edges, ["OAK"], ["MCO"], 4)).toEqual(["LAS", "DEN"]);
  });

  it("does not invent a hub that has never been stored", () => {
    expect(selectSearchHubs(edges, ["OAK"], ["BUR"], 4)).toEqual([]);
  });

  it("caps the hub list", () => {
    expect(selectSearchHubs(edges, ["OAK"], ["MCO"], 1)).toEqual(["LAS"]);
  });
});

describe("legsForSearch", () => {
  it("asks for the direct flight, known hub legs, and the next Las Vegas morning", () => {
    expect(
      legsForSearch({
        origins: ["OAK"],
        destinations: ["MCO"],
        date: "2026-10-15",
        hubs: ["LAS"],
        fetchOvernightFromLas: true,
      }),
    ).toEqual([
      { origin: "OAK", destination: "MCO", date: "2026-10-15" },
      { origin: "OAK", destination: "LAS", date: "2026-10-15" },
      { origin: "LAS", destination: "MCO", date: "2026-10-15" },
      { origin: "LAS", destination: "MCO", date: "2026-10-16" },
    ]);
  });

  it("does not add a second date when the hub is not Las Vegas", () => {
    const legs = legsForSearch({
      origins: ["OAK"],
      destinations: ["MCO"],
      date: "2026-10-15",
      hubs: ["DEN"],
      fetchOvernightFromLas: true,
    });
    expect(legs.map((leg) => leg.date)).toEqual(["2026-10-15", "2026-10-15", "2026-10-15"]);
  });
});
