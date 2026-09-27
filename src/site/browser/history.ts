import { readFileSync, writeFileSync } from "node:fs";
import type { BrowserFareRecord } from "@/site/network";
import { sanitizeBrowserResult } from "@/site/browser/sanitize";
import type { BrowserResult } from "@/site/browser/types";

export type FareType = "standard" | "discountDen" | "goWild";

export type PriceObservation = {
  origin: string;
  destination: string;
  date: string;
  flightNumber: string;
  departureLocal: string;
  fareType: FareType;
  price: number;
  observedAt: string;
};

export function priceObservationsFrom(result: BrowserResult): PriceObservation[] {
  const clean = sanitizeBrowserResult(result, "USD");
  if (clean.status !== "ok") return [];
  return rowsFromFlights(
    clean.flights.map((flight) => ({
      origin: flight.origin,
      destination: flight.destination,
      date: clean.query.date,
      flightNumber: flight.flightNumber,
      departureLocal: flight.departureLocal,
      retrievedAt: clean.retrievedAt,
      standard: flight.fares.standard,
      discountDen: flight.fares.discountDen,
      goWild: flight.fares.goWild,
    })),
  );
}

export function priceObservationsFromFares(fares: BrowserFareRecord[]): PriceObservation[] {
  return rowsFromFlights(fares);
}

export function appendPriceHistory(file: string, rows: PriceObservation[]) {
  if (!rows.length) return;
  let previous = "";
  try {
    previous = readFileSync(file, "utf8");
  } catch {
    previous = "";
  }
  const existing = new Set(previous.split("\n").filter((line) => line.length > 0));
  const lines = rows.map((row) => JSON.stringify(row)).filter((line) => !existing.has(line));
  if (!lines.length) return;
  const prefix = previous.length === 0 ? "" : previous.endsWith("\n") ? previous : `${previous}\n`;
  writeFileSync(file, `${prefix}${lines.join("\n")}\n`);
}

function rowsFromFlights(
  flights: Array<{
    origin: string;
    destination: string;
    date: string;
    flightNumber: string;
    departureLocal: string;
    retrievedAt: string;
    standard: { total: number } | null;
    discountDen: { total: number } | null;
    goWild: { total: number } | null;
  }>,
): PriceObservation[] {
  const rows: PriceObservation[] = [];
  for (const flight of flights) {
    const quotes: Array<[FareType, { total: number } | null]> = [
      ["standard", flight.standard],
      ["discountDen", flight.discountDen],
      ["goWild", flight.goWild],
    ];
    for (const [fareType, quote] of quotes) {
      if (!quote || quote.total < 0) continue;
      rows.push({
        origin: flight.origin,
        destination: flight.destination,
        date: flight.date,
        flightNumber: flight.flightNumber,
        departureLocal: flight.departureLocal,
        fareType,
        price: quote.total,
        observedAt: flight.retrievedAt,
      });
    }
  }
  return rows;
}
