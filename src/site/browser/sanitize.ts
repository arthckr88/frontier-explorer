import type { BrowserFlight, BrowserResult } from "@/site/browser/types";
import { BROWSER_SOURCE } from "@/site/browser/types";

const SECRET_KEY = /cookie|set-cookie|token|authorization|password|session|device-id|x-px|px-captcha|secret/i;

export function sanitizeBrowserResult(result: BrowserResult, currency: string | null = null): BrowserResult {
  return {
    query: {
      origin: airport(result.query.origin),
      destination: airport(result.query.destination),
      date: dateOnly(result.query.date),
    },
    status: result.status,
    source: BROWSER_SOURCE,
    retrievedAt: result.retrievedAt,
    flights: result.status === "ok" ? result.flights.map((flight) => sanitizeFlight(flight, currency)) : [],
  };
}

export function sanitizeFlight(flight: BrowserFlight, currency: string | null): BrowserFlight {
  return {
    carrier: flight.carrier,
    flightNumber: flight.flightNumber,
    origin: airport(flight.origin),
    destination: airport(flight.destination),
    departureLocal: flight.departureLocal,
    arrivalLocal: flight.arrivalLocal,
    durationMinutes: flight.durationMinutes,
    stops: flight.stops,
    fares: {
      standard: withCurrency(flight.fares.standard, currency),
      discountDen: withCurrency(flight.fares.discountDen, currency),
      goWild: withCurrency(flight.fares.goWild, currency),
    },
    seatsRemaining: flight.seatsRemaining,
  };
}

export function stripSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripSecretKeys(item));
  if (!isRecord(value)) return value;
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    clean[key] = stripSecretKeys(item);
  }
  return clean;
}

export type MarketList = {
  retrievedAt: string;
  expiresAt: string;
  source: "frontier_browser_markets";
  markets: Array<{ from: string; to: string[] }>;
};

export function sanitizeMarkets(payload: unknown, retrievedAt: string, expiresAt: string): MarketList {
  const markets: Array<{ from: string; to: string[] }> = [];
  const rows = isRecord(payload) && Array.isArray(payload.markets) ? payload.markets : [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const from = airport(text(row.fromStation) ?? "");
    const to = Array.isArray(row.toStations) ? row.toStations.map((item) => airport(text(item) ?? "")).filter(Boolean) : [];
    if (!from || to.length === 0) continue;
    markets.push({ from, to: [...new Set(to)].sort() });
  }
  return { retrievedAt, expiresAt, source: "frontier_browser_markets", markets };
}

function withCurrency(fare: BrowserFlight["fares"]["standard"], currency: string | null) {
  if (!fare) return null;
  return {
    available: true,
    total: fare.total,
    display: fare.display,
    currency: fare.currency ?? currency,
  };
}

function airport(value: string): string {
  return value.toUpperCase();
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
