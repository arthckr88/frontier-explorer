import { DateTime } from "luxon";
import type { OfficialRoute } from "@/site/direct-routes";
import type { AirportDeparture } from "@/static/types";

export const PDX_ROUTES_URL = "https://www.flypdx.com/NonstopDestinations";
export const PDX_FLIGHTS_URL = "https://www.flypdx.com/Flights";

function embeddedRows(html: string, key: string): Record<string, unknown>[] {
  const match = new RegExp(`${key}:\\s*(\\[.*?\\]),\\s*\\r?\\n`, "s").exec(html);
  if (!match) throw new Error(`The public airport page no longer contains ${key}. Existing data was preserved.`);
  const rows: unknown = JSON.parse(match[1]!);
  if (!Array.isArray(rows)) throw new Error(`Invalid ${key} airport data.`);
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

export function parsePdxRoutes(html: string, retrievedAt: string): OfficialRoute[] {
  const routes: OfficialRoute[] = [];
  for (const row of embeddedRows(html, "NonstopDestinations")) {
    const airline = row.Airline as { IataCode?: string } | undefined;
    const destination = row.Destination as { Code?: string; City?: string } | undefined;
    if (row.IsActive !== true || airline?.IataCode !== "F9" || !/^[A-Z]{3}$/.test(destination?.Code ?? "")) continue;
    routes.push({ origin: "PDX", destination: destination!.Code!, originCity: "Portland", destinationCity: destination?.City || destination!.Code!, sourceUrl: PDX_ROUTES_URL,
      provenance: "frontier_official_direct_route", seasonal: row.IsSeasonal === true,
      nonstopEvidence: { kind: "airport_nonstop", sourceUrl: PDX_ROUTES_URL, retrievedAt } });
  }
  if (!routes.length) throw new Error("The airport page supplied no active Frontier nonstops. Existing data was preserved.");
  return routes.sort((a, b) => a.destination.localeCompare(b.destination));
}

export function parsePdxDepartures(html: string, routes: OfficialRoute[], retrievedAt: string): AirportDeparture[] {
  const direct = new Set(routes.filter((route) => route.origin === "PDX").map((route) => route.destination));
  const departures: AirportDeparture[] = [];
  for (const row of embeddedRows(html, "Flights")) {
    const cities = row.Cities as { Code?: string }[] | undefined;
    if (row.CarrierCode !== "F9" || row.ScheduleType !== "D" || cities?.length !== 1 || !direct.has(cities[0]?.Code ?? "")) continue;
    if (typeof row.ScheduledTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(row.ScheduledTime) || !DateTime.fromISO(row.ScheduledTime).isValid) continue;
    if (!/^\d+$/.test(String(row.FlightNo))) continue;
    if (["CX", "CN", "C", "CANCELLED", "CANCELED"].includes(String(row.StatusCode).toUpperCase())) continue;
    departures.push({ origin: "PDX", destination: cities[0]!.Code!, date: row.ScheduledTime.slice(0, 10), departureLocal: row.ScheduledTime,
      flightNumber: String(row.FlightNo), status: row.StatusCode === "DP" ? "departed" : "scheduled", sourceUrl: PDX_FLIGHTS_URL, retrievedAt });
  }
  return departures.sort((a, b) => a.departureLocal.localeCompare(b.departureLocal));
}
