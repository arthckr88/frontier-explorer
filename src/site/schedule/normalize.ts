import type { Observation, ScheduleProvenance } from "@/site/view";
import { utcToLocal } from "@/site/time";

export type AeroScheduleRow = {
  ident?: string | null;
  ident_icao?: string | null;
  ident_iata?: string | null;
  actual_ident_icao?: string | null;
  scheduled_out?: string | null;
  scheduled_in?: string | null;
  origin_iata?: string | null;
  destination_iata?: string | null;
  blocked?: boolean;
};

export function normalizeAeroSchedules(
  rows: AeroScheduleRow[],
  zones: Map<string, string>,
  retrievedAt: string,
  expected?: { origin: string; destination: string },
): Observation[] {
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const observation = normalizeAeroSchedule(row, zones, retrievedAt, expected);
    if (!observation) continue;
    const token = `${observation.origin}|${observation.destination}|${observation.date}|${observation.flightNumber}|${observation.departureLocal}`;
    if (seen.has(token)) continue;
    seen.add(token);
    observations.push(observation);
  }
  return observations;
}

export function normalizeAeroSchedule(
  row: AeroScheduleRow,
  zones: Map<string, string>,
  retrievedAt: string,
  expected?: { origin: string; destination: string },
): Observation | null {
  if (row.blocked) return null;
  const ident = (row.ident_icao || row.ident || "").toUpperCase();
  if (!ident.startsWith("FFT")) return null;
  const actual = (row.actual_ident_icao || "").toUpperCase();
  if (actual && !actual.startsWith("FFT")) return null;
  const origin = (row.origin_iata || "").toUpperCase();
  const destination = (row.destination_iata || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
  if (expected && (origin !== expected.origin || destination !== expected.destination)) return null;
  const flightNumber = flightNumberFromIdent(ident);
  if (!flightNumber || !row.scheduled_out || !row.scheduled_in) return null;
  const departureLocal = utcToLocal(row.scheduled_out, zones.get(origin) ?? "");
  const arrivalLocal = utcToLocal(row.scheduled_in, zones.get(destination) ?? "");
  if (!departureLocal || !arrivalLocal) return null;
  const provenance: ScheduleProvenance = "flightaware_schedule";
  return {
    origin,
    destination,
    date: departureLocal.slice(0, 10),
    flightNumber,
    departureLocal,
    arrivalLocal,
    departureUtc: toZulu(row.scheduled_out),
    arrivalUtc: toZulu(row.scheduled_in),
    source: "FlightAware published schedule",
    retrievedAt,
    provenance,
  };
}

export function flightNumberFromIdent(ident: string): string | null {
  const match = ident.toUpperCase().match(/^FFT0*(\d+)$/);
  return match?.[1] ?? null;
}

function toZulu(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}
