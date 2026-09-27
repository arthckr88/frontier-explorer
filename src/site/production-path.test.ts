import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../../site/app.js", import.meta.url), "utf8");
const pages = readFileSync(new URL("../../scripts/build-pages.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const workflows = readdirSync(new URL("../../.github/workflows", import.meta.url))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();

describe("GitHub Pages reads the booking observation artifact", () => {
  it("loads network.json and not the 2LNR upcoming file", () => {
    expect(app).toContain('fetch("network.json")');
    expect(app).not.toContain("upcoming.json");
    expect(app).not.toContain("on-time file");
    expect(app).not.toContain("Saved flight");
    expect(app).not.toMatch(/date < "2026-09-27"/);
    expect(app).not.toContain("2026-09-27");
    expect(html).toContain('id="provenance"');
    expect(pages).toContain("network.json");
    expect(pages).toContain("route-changes.json");
    expect(pages).not.toContain("operating-days.json");
    expect(pages).not.toContain("nonstops.json");
    expect(pages).not.toContain("upcoming.json");
  });

  it("keeps Pages deploy on main and does not schedule Frontier or FlightAware", () => {
    expect(workflows).toEqual(["ci.yml", "deploy.yml"]);
    expect(deploy).toContain("npm run build:pages");
    expect(deploy).toContain("refs/heads/main");
    expect(deploy).not.toContain("cursor/frontier-route-explorer-596d");
    expect(ci).toContain("npm run check:integrity");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run build:pages");
    const text = workflows
      .map((name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"))
      .join("\n");
    expect(text).not.toContain("npm run update:published");
    expect(text).not.toContain("frontier:browser");
    expect(text).not.toContain("schedules:frontier");
    expect(text).not.toContain("FLIGHTAWARE_API_KEY");
    expect(text).not.toContain("aeroapi");
    expect(text).not.toContain("cron:");
    expect(text).not.toContain("/api/cron");
  });
});
