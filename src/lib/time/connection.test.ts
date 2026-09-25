import { describe, expect, it } from "vitest";
import { connectionMinutes, elapsedMinutes } from "@/lib/time/connection";
import { timingCopy } from "@/lib/time/copy";

describe("timezone-aware durations", () => {
  it("measures the spring-forward hour in America/New_York as 60 minutes, not 120", () => {
    const minutes = connectionMinutes(
      "2026-03-08T01:30:00",
      "America/New_York",
      "2026-03-08T03:30:00",
      "America/New_York",
    );
    expect(minutes).toBe(60);
  });

  it("measures a two-hour actual connection across the same spring-forward", () => {
    const minutes = connectionMinutes(
      "2026-03-08T01:00:00",
      "America/New_York",
      "2026-03-08T04:00:00",
      "America/New_York",
    );
    expect(minutes).toBe(120);
  });

  it("does not subtract local clock faces across the continent", () => {
    const minutes = elapsedMinutes(
      "2026-06-15T08:00:00",
      "America/Los_Angeles",
      "2026-06-15T16:30:00",
      "America/New_York",
    );
    expect(minutes).toBe(330);
  });
});

describe("timing copy", () => {
  it("counts down an upcoming start", () => {
    expect(
      timingCopy(
        {
          status: "UPCOMING",
          endConfirmed: false,
          announcedStartDate: "2026-10-12",
          announcedEndDate: null,
          lastScheduledDeparture: "2026-10-12",
          launchUnverified: false,
        },
        "2026-09-25",
      ),
    ).toBe("Starts in 17 days");
  });

  it("does not say a route ends unless the end is confirmed", () => {
    expect(
      timingCopy(
        {
          status: "ENDING_SOON",
          endConfirmed: false,
          announcedStartDate: null,
          announcedEndDate: null,
          lastScheduledDeparture: "2026-10-07",
          launchUnverified: false,
        },
        "2026-09-25",
      ),
    ).toBe("Last currently observed scheduled service in 12 days");
  });

  it("uses confirmed-end wording only when the end is confirmed", () => {
    expect(
      timingCopy(
        {
          status: "ENDING_SOON",
          endConfirmed: true,
          announcedStartDate: null,
          announcedEndDate: "2026-10-07",
          lastScheduledDeparture: "2026-10-07",
          launchUnverified: false,
        },
        "2026-09-25",
      ),
    ).toBe("Route ends in 12 days");
  });
});
