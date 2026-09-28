import { describe, expect, it } from "vitest";
import { classifyProbe, parseVerifyArgs, selectVerificationTargets, VERIFY_PAUSE_MS } from "@/site/verify-network";
import { parseBrowserArgs } from "@/site/browser/form";

const routes = [
  { origin: "DEN", destination: "MCO" },
  { origin: "OAK", destination: "LAS" },
  { origin: "ATL", destination: "SJU" },
];

describe("network verification", () => {
  it("resumes at the next unchecked official direct and skips a fresh cache", () => {
    const records = [
      { origin: "DEN", destination: "MCO", date: "2026-10-01", status: "ok" as const, retrievedAt: "2026-10-01T00:00:00.000Z" },
      { origin: "OAK", destination: "LAS", date: "2026-10-01", status: "unchecked" as const, retrievedAt: null },
    ];
    const selected = selectVerificationTargets(routes, records, new Map([["DEN", "united_states"], ["OAK", "united_states"], ["ATL", "united_states"]]), {
      date: "2026-10-01",
      limit: 1,
      officialOnly: true,
      uncheckedOnly: true,
      now: "2026-10-01T01:00:00.000Z",
    });
    expect(selected).toEqual([{ origin: "OAK", destination: "LAS" }]);
    expect(VERIFY_PAUSE_MS).toBe(15_000);
  });

  it("stops on a block and accepts any airport pair for the local collector", () => {
    expect(classifyProbe({ httpStatus: 403, flights: 0 }).stop).toBe(true);
    expect(classifyProbe({ httpStatus: 406, flights: 0 }).status).toBe("blocked");
    expect(classifyProbe({ error: "challenge page", flights: 0 }).stop).toBe(true);
    expect(classifyProbe({ flights: 2 }).status).toBe("ok");
    expect(classifyProbe({ flights: 0 }).status).toBe("no_flights");
    expect(parseVerifyArgs(["--date", "2026-10-01", "--limit", "1", "--origin", "DEN", "--official-only", "--unchecked-only"]).origin).toBe("DEN");
    expect(parseBrowserArgs(["--origin", "DEN", "--destination", "MCO", "--date", "2026-10-01"]).queries).toEqual([
      { origin: "DEN", destination: "MCO", date: "2026-10-01" },
    ]);
  });
});
