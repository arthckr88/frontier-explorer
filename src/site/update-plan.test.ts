import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyDayResult, planScheduleChecks } from "@/site/update-plan";
import type { ScheduleInput } from "@/site/network";
import { MAX_UPDATE_REQUESTS } from "@/site/view";

const published = JSON.parse(readFileSync(new URL("../../data/flights.json", import.meta.url), "utf8")) as ScheduleInput;

describe("bounded booking updates", () => {
  const plan = planScheduleChecks({
    today: "2026-09-27",
    flights: published.flights ?? [],
    checked: published.checked,
    blocked: published.blocked,
    routes: published.routes,
  });

  it("stays inside the current request budget and prefers uncovered priority corridors", () => {
    expect(plan.length).toBeLessThanOrEqual(MAX_UPDATE_REQUESTS);
    expect(plan.length).toBeGreaterThan(0);
    const discoveries = plan.filter((item) => item.reason === "discovery");
    expect(discoveries.some((item) => item.origin === "OAK")).toBe(true);
    const oak = discoveries.findIndex((item) => item.origin === "OAK");
    const sna = discoveries.findIndex((item) => item.origin === "SNA" || item.destination === "SNA");
    if (oak !== -1 && sna !== -1) expect(oak).toBeLessThan(sna);
    expect(plan.some((item) => item.origin === "AGU")).toBe(false);
  });

  it("does not treat HTTP 406 as an empty check", () => {
    const schedule = { flights: [], checked: [] as string[], blocked: [] as string[], blockMeta: {}, refreshedAt: null as string | null };
    applyDayResult(schedule, { origin: "SFO", destination: "SNA", date: "2026-10-22" }, { ok: false, blocked: true }, "2026-09-27", "2026-09-27T08:00:00Z");
    expect(schedule.checked).toEqual([]);
    expect(schedule.blocked).toEqual(["SFO|SNA|2026-10-22"]);
    expect(schedule.refreshedAt).toBeNull();
    applyDayResult(schedule, { origin: "SFO", destination: "SNA", date: "2026-10-22" }, { ok: true, flights: [] }, "2026-09-28", "2026-09-28T08:00:00Z");
    expect(schedule.blocked).toEqual([]);
    expect(schedule.checked).toEqual(["SFO|SNA|2026-10-22"]);
    expect(schedule.refreshedAt).toBe("2026-09-28T08:00:00Z");
  });
});
