import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../../site/app.js", import.meta.url), "utf8");
const pages = readFileSync(new URL("../../scripts/build-pages.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../.github/workflows/sync.yml", import.meta.url), "utf8");

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

  it("keeps the sync workflow on booking observations", () => {
    expect(workflow).toContain("npm run update:published");
    expect(workflow).toContain("npm run normalize:network");
    expect(workflow).toContain("npm run check:integrity");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run build:pages");
    expect(workflow).not.toContain("/api/cron");
    expect(workflow).toContain("data/network.json");
  });
});
