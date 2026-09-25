import { describe, expect, it } from "vitest";
import { reconcileNetwork } from "@/server/reconciliation/reconcile";
import type { Observation, RouteProjection } from "@/types/domain";

function schedule(partial: Partial<Observation> & Pick<Observation, "sourceId" | "retrievedAt" | "flights">): Observation {
  return {
    id: partial.id ?? `${partial.sourceId}-${partial.retrievedAt}`,
    sourceName: partial.sourceName ?? partial.sourceId,
    sourceTier: partial.sourceTier ?? 1,
    sourceKind: partial.sourceKind ?? "frontier_schedule",
    externalId: partial.externalId ?? `${partial.sourceId}-snapshot`,
    origin: partial.origin ?? "OAK",
    destination: partial.destination ?? "LAS",
    kind: "schedule_snapshot",
    successful: true,
    windowStart: partial.windowStart ?? "2026-09-01",
    windowEnd: partial.windowEnd ?? "2026-12-01",
    ...partial,
  };
}

function announcement(partial: Partial<Observation>): Observation {
  return {
    id: partial.id ?? "announcement",
    sourceId: partial.sourceId ?? "frontier-newsroom",
    sourceName: partial.sourceName ?? "Frontier Newsroom",
    sourceTier: partial.sourceTier ?? 1,
    sourceKind: "announcement",
    retrievedAt: partial.retrievedAt ?? "2026-09-25T12:00:00.000Z",
    externalId: partial.externalId ?? "story",
    origin: partial.origin ?? "OAK",
    destination: partial.destination ?? "LAS",
    kind: "announcement",
    announcementKind: partial.announcementKind ?? "launch",
    ...partial,
  };
}

function run(
  observations: Observation[],
  now: string,
  previous: RouteProjection[] = [],
) {
  return reconcileNetwork({ observations, previous, now });
}

describe("route reconciliation", () => {
  it("moves an active route to possibly ending and back to active without marking it ended", () => {
    const first = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-01T12:00:00.000Z",
          flights: [{ date: "2026-09-02" }, { date: "2026-09-05" }, { date: "2026-09-08" }],
          windowEnd: "2026-10-15",
        }),
      ],
      "2026-09-01T12:00:00.000Z",
    );
    expect(first.projections[0]?.status).toBe("ACTIVE");
    expect(first.changes.map((change) => change.type)).toContain("NEW_ROUTE");

    const second = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-20T12:00:00.000Z",
          flights: [{ date: "2026-09-02" }, { date: "2026-09-05" }, { date: "2026-09-08" }],
          windowEnd: "2026-10-20",
        }),
      ],
      "2026-09-20T12:00:00.000Z",
      first.projections,
    );
    expect(second.projections[0]?.status).toBe("POSSIBLY_ENDING");
    expect(second.projections[0]?.status).not.toBe("ENDED");
    expect(second.changes.map((change) => change.type)).toContain("POSSIBLE_ROUTE_END");

    const third = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-25T12:00:00.000Z",
          flights: [{ date: "2026-09-27" }, { date: "2026-09-30" }],
          windowEnd: "2026-10-25",
        }),
      ],
      "2026-09-25T12:00:00.000Z",
      second.projections,
    );
    expect(third.projections[0]?.status).toBe("ACTIVE");
    expect(third.changes.map((change) => change.type)).toContain("ROUTE_RETURNED");
  });

  it("moves active to ending soon and then to a confirmed end", () => {
    const active = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-01T12:00:00.000Z",
          flights: [{ date: "2026-09-10" }, { date: "2026-10-12" }],
          windowEnd: "2026-12-01",
        }),
        announcement({
          retrievedAt: "2026-09-01T12:00:00.000Z",
          announcementKind: "end",
          announcedEnd: "2026-10-12",
        }),
      ],
      "2026-09-01T12:00:00.000Z",
    );
    expect(active.projections[0]?.status).toBe("ACTIVE");

    const ending = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-25T12:00:00.000Z",
          flights: [{ date: "2026-09-10" }, { date: "2026-10-12" }],
          windowEnd: "2026-12-01",
        }),
        announcement({
          retrievedAt: "2026-09-25T12:00:00.000Z",
          announcementKind: "end",
          announcedEnd: "2026-10-12",
        }),
      ],
      "2026-09-25T12:00:00.000Z",
      active.projections,
    );
    expect(ending.projections[0]?.status).toBe("ENDING_SOON");
    expect(ending.projections[0]?.endConfirmed).toBe(true);
    expect(ending.projections[0]?.confidence).toBe("HIGH");

    const ended = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-10-13T12:00:00.000Z",
          flights: [{ date: "2026-09-10" }, { date: "2026-10-12" }],
          windowEnd: "2026-12-01",
        }),
        announcement({
          retrievedAt: "2026-10-13T12:00:00.000Z",
          announcementKind: "end",
          announcedEnd: "2026-10-12",
        }),
      ],
      "2026-10-13T12:00:00.000Z",
      ending.projections,
    );
    expect(ended.projections[0]?.status).toBe("ENDED");
    expect(ended.projections[0]?.endConfirmed).toBe(true);
    expect(ended.changes.map((change) => change.type)).toContain("ROUTE_END_CONFIRMED");
  });

  it("moves announced to upcoming to active", () => {
    const announced = run(
      [
        announcement({
          retrievedAt: "2026-09-25T12:00:00.000Z",
          announcedStart: "2026-11-01",
          announcementKind: "launch",
        }),
      ],
      "2026-09-25T12:00:00.000Z",
    );
    expect(announced.projections[0]?.status).toBe("ANNOUNCED");
    expect(announced.projections[0]?.confidence).toBe("UNKNOWN");

    const upcoming = run(
      [
        announcement({
          retrievedAt: "2026-10-01T12:00:00.000Z",
          announcedStart: "2026-11-01",
        }),
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-10-01T12:00:00.000Z",
          flights: [{ date: "2026-11-01" }, { date: "2026-11-03" }],
          windowEnd: "2026-12-15",
        }),
      ],
      "2026-10-01T12:00:00.000Z",
      announced.projections,
    );
    expect(upcoming.projections[0]?.status).toBe("UPCOMING");

    const active = run(
      [
        announcement({
          retrievedAt: "2026-11-01T15:00:00.000Z",
          announcedStart: "2026-11-01",
        }),
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-11-01T15:00:00.000Z",
          flights: [{ date: "2026-11-01" }, { date: "2026-11-03" }],
          windowEnd: "2026-12-15",
        }),
      ],
      "2026-11-01T15:00:00.000Z",
      upcoming.projections,
    );
    expect(active.projections[0]?.status).toBe("ACTIVE");
    expect(active.changes.map((change) => change.type)).toContain("ROUTE_STARTED");
  });

  it("keeps a seasonal disappearance seasonal instead of ended", () => {
    const summer = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-06-01T12:00:00.000Z",
          flights: [{ date: "2026-06-02" }, { date: "2026-06-09" }],
          windowEnd: "2026-08-01",
        }),
        announcement({
          retrievedAt: "2026-06-01T12:00:00.000Z",
          seasonal: true,
          announcementKind: "seasonal",
          announcedStart: "2026-06-01",
        }),
      ],
      "2026-06-01T12:00:00.000Z",
    );
    expect(summer.projections[0]?.status).toBe("ACTIVE");

    const winter = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-11-15T12:00:00.000Z",
          flights: [{ date: "2026-06-02" }, { date: "2026-06-09" }],
          windowEnd: "2027-02-15",
        }),
        announcement({
          retrievedAt: "2026-11-15T12:00:00.000Z",
          seasonal: true,
          announcementKind: "seasonal",
        }),
      ],
      "2026-11-15T12:00:00.000Z",
      summer.projections,
    );
    expect(winter.projections[0]?.status).toBe("SEASONAL");
    expect(winter.projections[0]?.status).not.toBe("ENDED");
    expect(winter.changes.map((change) => change.type)).toContain("SEASONAL_PAUSE");
  });

  it("surfaces an October 12 versus October 16 source disagreement without confirming an end", () => {
    const result = run(
      [
        schedule({
          id: "a",
          sourceId: "frontier-schedule",
          sourceName: "Frontier schedule",
          retrievedAt: "2026-09-25T12:00:00.000Z",
          flights: [{ date: "2026-10-05" }, { date: "2026-10-12" }],
          windowEnd: "2026-12-01",
        }),
        schedule({
          id: "b",
          sourceId: "timetable",
          sourceName: "Secondary timetable",
          sourceKind: "timetable_api",
          sourceTier: 3,
          externalId: "timetable-snapshot",
          retrievedAt: "2026-09-25T12:00:00.000Z",
          flights: [{ date: "2026-10-08" }, { date: "2026-10-16" }],
          windowEnd: "2026-12-01",
        }),
      ],
      "2026-09-25T12:00:00.000Z",
    );
    const route = result.projections[0];
    expect(route?.confidence).toBe("CONFLICTING");
    expect(route?.status).not.toBe("ENDED");
    expect(route?.endConfirmed).toBe(false);
    expect(route?.suspectedEndDate).toBeNull();
    const values = route?.disagreements.flatMap((item) => item.values.map((value) => value.value)) ?? [];
    expect(values).toContain("2026-10-12");
    expect(values).toContain("2026-10-16");
    expect(result.changes.map((change) => change.type)).toContain("SOURCE_DISAGREEMENT");
  });

  it("does not mark a twice-weekly route stale just because nothing flies tomorrow", () => {
    const result = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-26T18:00:00.000Z",
          flights: [{ date: "2026-09-28" }, { date: "2026-10-01" }],
          frequencyPerWeek: 2,
          windowEnd: "2026-10-30",
        }),
      ],
      "2026-09-26T18:00:00.000Z",
    );
    expect(result.projections[0]?.status).toBe("ACTIVE");
    expect(result.projections[0]?.status).not.toBe("STALE");
    expect(result.projections[0]?.currentFrequencyPerWeek).toBe(2);
  });

  it("does not treat an old unchecked snapshot as a confirmed disappearance", () => {
    const result = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-01T12:00:00.000Z",
          flights: [{ date: "2026-09-02" }],
          windowEnd: "2026-09-20",
        }),
      ],
      "2026-09-05T12:00:00.000Z",
    );
    expect(result.projections[0]?.status).toBe("STALE");
    expect(result.projections[0]?.status).not.toBe("ENDED");
  });

  it("keeps OAK→LAS independent from LAS→OAK", () => {
    const result = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          origin: "OAK",
          destination: "LAS",
          externalId: "oak-las",
          retrievedAt: "2026-09-25T12:00:00.000Z",
          frequencyPerWeek: 7,
          flights: [{ date: "2026-09-26" }, { date: "2026-09-27" }],
        }),
        schedule({
          sourceId: "frontier-schedule",
          origin: "LAS",
          destination: "OAK",
          externalId: "las-oak",
          retrievedAt: "2026-09-25T12:00:00.000Z",
          frequencyPerWeek: 4,
          flights: [{ date: "2026-09-26" }],
        }),
      ],
      "2026-09-25T12:00:00.000Z",
    );
    const outbound = result.projections.find((route) => route.origin === "OAK" && route.destination === "LAS");
    const inbound = result.projections.find((route) => route.origin === "LAS" && route.destination === "OAK");
    expect(outbound?.currentFrequencyPerWeek).toBe(7);
    expect(inbound?.currentFrequencyPerWeek).toBe(4);
    expect(outbound?.currentFrequencyPerWeek).not.toBe(inbound?.currentFrequencyPerWeek);
  });

  it("retains the previous projection when a later sync produces no observations", () => {
    const first = run(
      [
        schedule({
          sourceId: "frontier-schedule",
          retrievedAt: "2026-09-25T12:00:00.000Z",
          flights: [{ date: "2026-09-26" }],
        }),
      ],
      "2026-09-25T12:00:00.000Z",
    );
    const second = run([], "2026-09-25T14:00:00.000Z", first.projections);
    expect(second.projections).toHaveLength(1);
    expect(second.projections[0]?.status).toBe("ACTIVE");
    expect(second.changes).toHaveLength(0);
  });
});
