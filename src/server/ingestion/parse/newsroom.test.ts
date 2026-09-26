import { describe, expect, it } from "vitest";
import { parseNewsroomFeed } from "@/server/ingestion/parse/newsroom";
import { parseMarketedSamples } from "@/server/ingestion/parse/marketed";
import { parseProgramText } from "@/server/ingestion/parse/programs";

const fixture = `<?xml version="1.0"?><rss><channel><item>
<title>Example launch</title>
<link>https://news.flyfrontier.com/example/</link>
<pubDate>Tue, 14 Jul 2026 10:00:00 -0600</pubDate>
<pp:caseid>100</pp:caseid>
<description><![CDATA[
<p><strong>New service from Denver International Airport (DEN):</strong></p>
<table><tr><td>SERVICE TO:</td><td>SERVICE START:</td><td>SERVICE FREQUENCY:</td></tr>
<tr><td>Fort Lauderdale, Fla. (FLL)</td><td>Nov. 20</td><td>Daily</td></tr>
<tr><td>San Juan, Puerto Rico (SJU)</td><td>Dec. 17, 2026</td><td>4x/week</td></tr>
</table>
<p>Also mentions Orlando (MCO) and Miami (MIA) without a from/to pair.</p>
]]></description>
</item></channel></rss>`;

describe("newsroom parser", () => {
  it("extracts directional table rows and ignores loose airport mentions", () => {
    const observations = parseNewsroomFeed(fixture, "2026-09-25T12:00:00.000Z");
    expect(observations).toHaveLength(2);
    expect(observations.map((item) => `${item.origin}-${item.destination}`).sort()).toEqual([
      "DEN-FLL",
      "DEN-SJU",
    ]);
    const fll = observations.find((item) => item.destination === "FLL");
    expect(fll?.announcedStart).toBe("2026-11-20");
    expect(fll?.announcedFrequencyPerWeek).toBe(7);
    expect(fll?.kind).toBe("announcement");
    const sju = observations.find((item) => item.destination === "SJU");
    expect(sju?.announcedFrequencyPerWeek).toBe(4);
    expect(sju?.announcedStart).toBe("2026-12-17");
  });
});

describe("marketed sample parser", () => {
  it("reads coded deal snippets and does not invent a timetable", () => {
    const html = `<p>Oakland, CA (OAK) Las Vegas, NV (LAS) One-way Departing Oct 27, 2026 From $19</p>
      <p>More flights from Oakland, CA Oakland, CA - Phoenix, AZ</p>`;
    const samples = parseMarketedSamples(html, "https://example.test/oak", "2026-09-25T00:00:00.000Z");
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      origin: "OAK",
      destination: "LAS",
      marketedDate: "2026-10-27",
      kind: "marketed_sample",
    });
  });
});

describe("program parser", () => {
  it("extracts rules that are present and does not invent blackouts", () => {
    const text = `Flights can be booked and confirmed the day before flight departure for domestic travel and starting 10 days before flight departure for international travel. Your per-segment airfare is $0.01, plus taxes and fees.`;
    const rules = parseProgramText(text, "gowild");
    expect(rules.map((rule) => rule.ruleKey)).toEqual([
      "domestic_booking_window",
      "international_booking_window",
      "base_fare",
    ]);
    expect(rules.some((rule) => rule.ruleKey === "blackout")).toBe(false);
    expect(parseProgramText("The following blackout travel dates apply: Dec.", "gowild").some((rule) => rule.ruleKey === "blackout")).toBe(false);
    expect(parseProgramText("including blackout dates as posted. Summer 2026 Pass: April 22, 2026", "gowild").some((rule) => rule.ruleKey === "blackout")).toBe(false);
    const dated = parseProgramText("The following blackout travel dates apply: Dec. 20 through Jan. 2.", "gowild");
    expect(dated.some((rule) => rule.ruleKey === "blackout")).toBe(true);
  });
});
