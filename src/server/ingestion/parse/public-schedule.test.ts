import { describe, expect, it } from "vitest";
import { parseBookingMarkets, parsePublicScheduleHtml } from "@/server/ingestion/parse/public-schedule";

function resultsPage(data: unknown) {
  const encoded = JSON.stringify(data).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<html><script>FlightData = '${encoded}';</script></html>`;
}

describe("public booking schedule parser", () => {
  it("reads nonstop Frontier flights and ignores connections and other carriers", () => {
    const html = resultsPage({
      originOne: "OAK",
      destinationOne: "LAS",
      departureDateOne: "2026-09-28T00:00:00",
      journeys: [
        {
          flights: [
            {
              stopCount: 0,
              legs: [
                {
                  carrierCode: "F9",
                  flightNumber: 2046,
                  departureStation: "OAK",
                  arrivalStation: "LAS",
                  departureDate: "2026-09-28T10:17:00",
                  arrivalDate: "2026-09-28T11:58:00",
                },
              ],
            },
            {
              stopCount: 0,
              legs: [
                {
                  carrierCode: "F9",
                  flightNumber: 3838,
                  departureStation: "OAK",
                  arrivalStation: "LAS",
                  departureDate: "2026-09-28T18:51:00",
                  arrivalDate: "2026-09-28T20:32:00",
                },
              ],
            },
            {
              stopCount: 1,
              legs: [
                {
                  carrierCode: "F9",
                  flightNumber: 111,
                  departureStation: "OAK",
                  arrivalStation: "DEN",
                  departureDate: "2026-09-28T08:00:00",
                  arrivalDate: "2026-09-28T11:30:00",
                },
                {
                  carrierCode: "F9",
                  flightNumber: 222,
                  departureStation: "DEN",
                  arrivalStation: "LAS",
                  departureDate: "2026-09-28T13:00:00",
                  arrivalDate: "2026-09-28T14:10:00",
                },
              ],
            },
            {
              stopCount: 0,
              legs: [
                {
                  carrierCode: "Y4",
                  flightNumber: 999,
                  departureStation: "OAK",
                  arrivalStation: "LAS",
                  departureDate: "2026-09-28T15:00:00",
                  arrivalDate: "2026-09-28T16:30:00",
                },
              ],
            },
          ],
        },
      ],
    });
    const parsed = parsePublicScheduleHtml(html);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query).toEqual({ origin: "OAK", destination: "LAS", date: "2026-09-28" });
    expect(parsed.flights).toEqual([
      {
        origin: "OAK",
        destination: "LAS",
        flightNumber: "2046",
        date: "2026-09-28",
        departureLocal: "2026-09-28T10:17:00",
        arrivalLocal: "2026-09-28T11:58:00",
      },
      {
        origin: "OAK",
        destination: "LAS",
        flightNumber: "3838",
        date: "2026-09-28",
        departureLocal: "2026-09-28T18:51:00",
        arrivalLocal: "2026-09-28T20:32:00",
      },
    ]);
  });

  it("rejects FlightData that does not name the searched pair", () => {
    const html = resultsPage({
      journeys: [
        {
          flights: [
            {
              stopCount: 0,
              legs: [
                {
                  carrierCode: "F9",
                  flightNumber: 2046,
                  departureStation: "OAK",
                  arrivalStation: "LAS",
                  departureDate: "2026-09-28T10:17:00",
                  arrivalDate: "2026-09-28T11:58:00",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(parsePublicScheduleHtml(html).ok).toBe(false);
  });

  it("does not treat a page without FlightData as an empty schedule", () => {
    const parsed = parsePublicScheduleHtml("<html><p>There are no flights available for the day you selected.</p></html>");
    expect(parsed.ok).toBe(false);
  });

  it("reads station markets from the public booking homepage", () => {
    const html = `<script>{"stations":[{"code":"US","stations":[{"code":"OAK","markets":["LAS","LAX","LAS"]}]}]}</script>`;
    expect(parseBookingMarkets(html).get("OAK")).toEqual(["LAS", "LAX"]);
  });
});
