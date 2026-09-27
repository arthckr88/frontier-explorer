import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { localToUtc, scheduleToday as luxonToday, zonedMinutes } from "@/site/time";
import { scheduleToday } from "@/site/view";

describe("Pacific time conversion", () => {
  it("converts a September Oakland departure during PDT", () => {
    expect(localToUtc("2026-09-27T10:17:00", "America/Los_Angeles")).toBe("2026-09-27T17:17:00Z");
  });

  it("converts a November departure during PST", () => {
    expect(localToUtc("2026-11-21T19:13:00", "America/Los_Angeles")).toBe("2026-11-22T03:13:00Z");
  });

  it("measures the Pacific spring-forward hour as 60 minutes", () => {
    expect(zonedMinutes("2026-03-08T01:30:00", "America/Los_Angeles", "2026-03-08T03:30:00", "America/Los_Angeles")).toBe(60);
  });

  it("agrees on the Los Angeles calendar date around midnight", () => {
    const evening = new Date("2026-09-27T06:30:00Z");
    const afterMidnight = new Date("2026-09-27T07:30:00Z");
    expect(scheduleToday(evening)).toBe("2026-09-26");
    expect(scheduleToday(afterMidnight)).toBe("2026-09-27");
    expect(scheduleToday(evening)).toBe(luxonToday(DateTime.fromJSDate(evening)));
    expect(scheduleToday(afterMidnight)).toBe(luxonToday(DateTime.fromJSDate(afterMidnight)));
  });
});
