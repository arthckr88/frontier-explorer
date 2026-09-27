import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildNetwork, confirmedArcKeys, diffSnapshots, integrityErrors, mergeChanges, snapshotsFrom, type ScheduleInput } from "@/site/network";
import {
  calendarMarks,
  dateVerdict,
  departuresPhrase,
  describePair,
  lineWeight,
  provenanceModel,
  provenanceText,
  type Check,
  type Observation,
} from "@/site/view";

const TODAY = "2026-09-27";
const published = JSON.parse(readFileSync(new URL("../../data/flights.json", import.meta.url), "utf8")) as ScheduleInput;

function flight(origin: string, destination: string, date: string, flightNumber: string, departure = "10:00"): Observation {
  const departureLocal = `${date}T${departure}:00`;
  return {
    origin,
    destination,
    date,
    flightNumber,
    departureLocal,
    arrivalLocal: `${date}T12:00:00`,
    departureUtc: `${date}T17:00:00Z`,
    arrivalUtc: `${date}T19:00:00Z`,
    source: "Frontier public booking observations",
    retrievedAt: null,
  };
}

describe("booking observations are the only confirmed arcs", () => {
  const network = buildNetwork(published, TODAY);

  it("does not turn listed markets into arcs", () => {
    const arcs = confirmedArcKeys(network, TODAY);
    expect(arcs.length).toBeGreaterThan(5);
    expect(arcs.length).toBeLessThan(40);
    expect(network.candidateCount).toBeGreaterThan(1000);
    expect(arcs).toContain("SFO|LAX");
    expect(arcs).toContain("OAK|LAS");
    expect(arcs).not.toContain("AGU|ATL");
    for (const key of arcs) {
      const [origin, destination] = key.split("|");
      expect(network.observations.some((item) => item.origin === origin && item.destination === destination && item.date >= TODAY)).toBe(true);
    }
  });

  it("keeps a timed SFO-LAX observation available", () => {
    const verdict = dateVerdict(network.observations, network.checks, "SFO", "LAX", TODAY);
    expect(verdict.kind).toBe("flight_found");
    expect(verdict.flights.map((item) => item.flightNumber).sort()).toEqual(["2858", "3308"]);
    expect(verdict.sentence).not.toMatch(/April|no upcoming|2LNR/i);
  });

  it("counts two Oakland to Las Vegas departures on one checked date", () => {
    const sameDay = network.observations.filter((item) => item.origin === "OAK" && item.destination === "LAS" && item.date === "2026-10-15");
    expect(sameDay).toHaveLength(2);
    const summary = network.summaries.find((item) => item.origin === "OAK" && item.destination === "LAS");
    expect(summary).toBeTruthy();
    const futureDates = summary?.observedDates.filter((date) => date >= TODAY) ?? [];
    expect(summary?.futureDepartureCount).toBeGreaterThan(futureDates.length);
    expect(summary?.departuresPhrase).toMatch(/departures across \d+ checked dates/);
    expect(summary?.departuresPhrase).not.toMatch(/flights\/week/);
  });

  it("keeps found, empty, blocked, and unchecked distinct", () => {
    const lasBur = network.checks.filter((check) => check.origin === "LAS" && check.destination === "BUR");
    expect(lasBur.some((check) => check.state === "flights_found")).toBe(true);
    expect(lasBur.some((check) => check.state === "checked_empty")).toBe(true);
    expect(lasBur.some((check) => check.state === "unchecked")).toBe(true);
    const sna = network.checks.filter((check) => check.origin === "SFO" && check.destination === "SNA");
    expect(sna.some((check) => check.state === "blocked")).toBe(true);
    expect(sna.find((check) => check.date === "2026-10-22")?.state).toBe("blocked");
    const marks = calendarMarks(network.checks, "LAS", "BUR");
    expect(marks["2026-10-01"]).toBe("flight");
    expect(marks["2026-10-17"]).toBe("empty");
    expect(marks["2026-10-02"]).toBe("unchecked");
  });

  it("describes the Las Vegas to Burbank hole without calling it discontinued", () => {
    const summary = network.summaries.find((item) => item.origin === "LAS" && item.destination === "BUR");
    expect(summary?.status).toBe("possible_gap");
    expect(summary?.gapNote).toMatch(/^Observed through 2026-10-01\. Later checks returned no nonstop on /);
    expect(summary?.gapNote).toMatch(/coverage incomplete/);
    expect(summary?.coverageNote).not.toMatch(/discontinued/i);
    expect(confirmedArcKeys(network, TODAY)).toContain("LAS|BUR");
  });

  it("does not draw a route that has only past observations", () => {
    const schedule: ScheduleInput = {
      flights: [
        {
          ...flight("SFO", "SAN", "2026-09-01", "1"),
        },
      ],
      checked: ["SFO|SAN|2026-09-01"],
      blocked: [],
      routes: [{ origin: "SFO", destination: "SAN", provenance: "scheduled" }],
    };
    const built = buildNetwork(schedule, TODAY);
    expect(confirmedArcKeys(built, TODAY)).not.toContain("SFO|SAN");
    const summary = built.summaries.find((item) => item.origin === "SFO" && item.destination === "SAN");
    expect(summary?.status).toBe("unknown");
    expect(summary?.coverageNote).toMatch(/Current operation is unknown/);
  });
});

describe("route summary rules", () => {
  it("counts two departures on one date and refuses a weekly rate from three checks", () => {
    const observations = [flight("OAK", "LAS", "2026-10-01", "2046", "10:17"), flight("OAK", "LAS", "2026-10-01", "3838", "18:51")];
    const checks: Check[] = [
      { origin: "OAK", destination: "LAS", date: "2026-10-01", state: "flights_found" },
      { origin: "OAK", destination: "LAS", date: "2026-10-02", state: "checked_empty" },
      { origin: "OAK", destination: "LAS", date: "2026-10-03", state: "checked_empty" },
    ];
    const summary = describePair("OAK", "LAS", observations, checks, TODAY);
    expect(summary.futureDepartureCount).toBe(2);
    expect(summary.futureCheckedDates).toBe(3);
    expect(summary.departuresPhrase).toBe(departuresPhrase(2, 3));
    expect(summary.departuresPhrase).toBe("2 departures across 3 checked dates.");
    expect(summary.weekdayLabel).toMatch(/not a weekly frequency/);
    expect(lineWeight(summary.futureDepartureCount, summary.futureCheckedDates, "near_term")).toBe(1);
    expect(lineWeight(6, 3, "near_term")).toBe(2);
    expect(lineWeight(4, 2, "near_term")).toBe(0);
    expect(lineWeight(1, 1, "near_term")).toBe(0);
  });

  it("keeps a future-only route out of the current status", () => {
    const observations = [flight("OAK", "ONT", "2026-11-21", "4222")];
    const checks: Check[] = [{ origin: "OAK", destination: "ONT", date: "2026-11-21", state: "flights_found" }];
    const summary = describePair("OAK", "ONT", observations, checks, TODAY);
    expect(summary.status).toBe("future");
    expect(summary.coverageNote).toMatch(/not evidence the route operates on 2026-09-27/);
    expect(confirmedArcKeys(buildNetwork({ flights: observations, checked: ["OAK|ONT|2026-11-21"], routes: [] }, TODAY), TODAY)).toContain("OAK|ONT");
  });

  it("does not infer an empty check from a missing date", () => {
    const verdict = dateVerdict([flight("SFO", "LAX", "2026-10-01", "1")], [], "SFO", "LAX", "2026-10-02");
    expect(verdict.kind).toBe("not_checked");
    expect(verdict.sentence).toMatch(/Not checked yet/);
    expect(verdict.sentence).not.toMatch(/empty|no service|April/i);
  });
});

describe("route change diff", () => {
  it("does not mark an unchanged snapshot, then records a real extension once", () => {
    const base = buildNetwork(published, TODAY);
    const snap = snapshotsFrom(base.observations, base.checks);
    expect(diffSnapshots(snap, snap, TODAY)).toEqual([]);
    const extended = structuredClone(snap);
    const pair = extended.pairs["OAK|LAS"];
    expect(pair).toBeTruthy();
    const last = [...(pair?.flights ?? [])].map((row) => row.slice(0, 10)).sort().at(-1);
    expect(last).toBeTruthy();
    const next = new Date(`${last}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const later = next.toISOString().slice(0, 10);
    pair?.flights.push(`${later}|2046|${later}T10:17:00`);
    const once = diffSnapshots(snap, extended, TODAY);
    expect(once.map((item) => item.type)).toContain("schedule_extended");
    expect(once.map((item) => item.type)).toContain("more_flights");
    expect(diffSnapshots(extended, extended, TODAY)).toEqual([]);
    const merged = mergeChanges(once, diffSnapshots(extended, extended, TODAY), TODAY);
    expect(merged).toHaveLength(once.length);
  });
});

describe("integrity", () => {
  it("accepts the real booking file and partial coverage", () => {
    const network = buildNetwork(published, TODAY);
    expect(integrityErrors(published, network)).toEqual([]);
    expect(network.coveragePartial).toBe(true);
  });

  it("rejects a confirmed arc that has no observation", () => {
    const network = buildNetwork(published, TODAY);
    network.summaries.push({
      ...network.summaries[0]!,
      origin: "OAK",
      destination: "BUR",
      observedDates: ["2026-10-01"],
      status: "observed",
    });
    const errors = integrityErrors(
      { ...published, routes: [...(published.routes ?? []), { origin: "OAK", destination: "BUR", provenance: "listed" }] },
      network,
    );
    expect(errors.some((error) => error.includes("OAK|BUR") && error.includes("no observation"))).toBe(true);
  });

  it("rejects an invalid timestamp", () => {
    const network = buildNetwork(
      {
        flights: [{ ...flight("SFO", "LAS", "2026-10-01", "1"), departureUtc: "not-a-time", arrivalUtc: "also-bad" }],
        checked: ["SFO|LAS|2026-10-01"],
        routes: [],
      },
      TODAY,
    );
    expect(integrityErrors({ flights: network.observations, checked: [], routes: [] }, network).some((error) => error.includes("Invalid timestamp"))).toBe(true);
  });
});

describe("provenance render model", () => {
  it("names the booking observations and an unrecorded refresh", () => {
    const model = provenanceModel({ lastRefresh: null, today: TODAY });
    expect(model.source).toBe("Frontier public booking observations");
    expect(provenanceText(model)).toMatch(/Frontier public booking observations/);
    expect(provenanceText(model)).toMatch(/not recorded/);
    expect(provenanceText(model)).toMatch(/not a nonstop/);
  });
});
