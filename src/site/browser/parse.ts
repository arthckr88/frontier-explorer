import type { BrowserFare, BrowserFlight, BrowserQuery, BrowserResult, BrowserStatus, PageCapture } from "@/site/browser/types";
import { BROWSER_SOURCE } from "@/site/browser/types";

const NO_FLIGHT_TEXT = /no flights?(?:\s+are)?\s+available|there are no flights|no flight options/i;
const CHALLENGE_TEXT = /perimeterx|px-captcha|access denied|verify you are a human|cf-challenge|captcha-delivery/i;

export function displayDollars(total: number): number {
  return Math.ceil(total);
}

export function classifyBookingPage(capture: PageCapture, query: BrowserQuery, retrievedAt: string): BrowserResult {
  const blank = (status: BrowserStatus): BrowserResult => ({
    query,
    status,
    source: BROWSER_SOURCE,
    retrievedAt,
    flights: [],
  });
  if (capture.httpStatus === 403 || capture.httpStatus === 406) return blank("blocked");
  const html = capture.html ?? "";
  const flightData = extractFlightData(html);
  if (flightData.ok) {
    const normalized = normalizeFlightData(flightData.data, query);
    if (!normalized.ok) return blank("parse_error");
    if (normalized.flights.length === 0) return blank("no_flights");
    return { ...blank("ok"), flights: normalized.flights };
  }
  if (isBlockedPage(capture.url, html)) return blank("blocked");
  if (onResultsPage(capture.url) && NO_FLIGHT_TEXT.test(html)) return blank("no_flights");
  if (onResultsPage(capture.url) && flightData.reason === "malformed") return blank("parse_error");
  if (onResultsPage(capture.url)) return blank("parse_error");
  return blank("navigation_error");
}

export function extractFlightData(html: string): { ok: true; data: unknown } | { ok: false; reason: "missing" | "malformed" } {
  const markers = ["FlightData = '", 'FlightData = "', "FlightData ="];
  for (const marker of markers) {
    const start = html.indexOf(marker);
    if (start < 0) continue;
    const from = start + marker.length;
    if (marker.endsWith("'") || marker.endsWith('"')) {
      const quote = marker.at(-1) ?? "'";
      const end = html.indexOf(`${quote};`, from);
      if (end < 0) return { ok: false, reason: "malformed" };
      const decoded = decodeFlightData(html.slice(from, end));
      try {
        return { ok: true, data: JSON.parse(decoded) };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    }
    const brace = html.indexOf("{", from);
    if (brace < 0) return { ok: false, reason: "malformed" };
    const end = matchingBrace(html, brace);
    if (end < 0) return { ok: false, reason: "malformed" };
    try {
      return { ok: true, data: JSON.parse(html.slice(brace, end)) };
    } catch {
      return { ok: false, reason: "malformed" };
    }
  }
  return { ok: false, reason: "missing" };
}

export function normalizeFlightData(data: unknown, query: BrowserQuery): { ok: true; flights: BrowserFlight[] } | { ok: false } {
  if (!isRecord(data)) return { ok: false };
  const journeys = data.journeys;
  if (!Array.isArray(journeys)) return { ok: false };
  const flights: BrowserFlight[] = [];
  for (const journey of journeys) {
    if (!isRecord(journey) || !Array.isArray(journey.flights)) return { ok: false };
    for (const itinerary of journey.flights) {
      if (!isRecord(itinerary)) return { ok: false };
      const flight = normalizeItinerary(itinerary, query);
      if (flight) flights.push(flight);
    }
  }
  return { ok: true, flights };
}

function normalizeItinerary(itinerary: Record<string, unknown>, query: BrowserQuery): BrowserFlight | null {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs.filter(isRecord) : [];
  const first = legs[0] ?? null;
  const last = legs.at(-1) ?? null;
  const carrier = text(itinerary.carrierCode) ?? text(first?.carrierCode);
  if (carrier && carrier.toUpperCase() !== "F9") return null;
  const flightNumber = numberText(itinerary.flightNumber) ?? numberText(first?.flightNumber);
  const origin = (text(itinerary.departureStation) ?? text(first?.departureStation) ?? query.origin).toUpperCase();
  const destination = (text(itinerary.arrivalStation) ?? text(last?.arrivalStation) ?? query.destination).toUpperCase();
  const departureLocal = localTimestamp(text(itinerary.departureDate) ?? text(first?.departureDate));
  const arrivalLocal = localTimestamp(text(itinerary.arrivalDate) ?? text(last?.arrivalDate));
  if (!flightNumber || !departureLocal || !arrivalLocal) return null;
  if (origin !== query.origin || destination !== query.destination) return null;
  const stops = readStops(itinerary, legs.length);
  return {
    carrier: carrier ? carrier.toUpperCase() : null,
    flightNumber,
    origin,
    destination,
    departureLocal,
    arrivalLocal,
    durationMinutes: minutesBetween(departureLocal, arrivalLocal),
    stops,
    fares: {
      standard: readFare(itinerary.standardFare ?? first?.standardFare),
      discountDen: readFare(itinerary.discountDenFare ?? first?.discountDenFare),
      goWild: readFare(itinerary.goWildFare ?? first?.goWildFare),
    },
    seatsRemaining: readSeats(itinerary) ?? (first ? readSeats(first) : null),
  };
}

function readFare(value: unknown): BrowserFare | null {
  const total = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (total == null || total < 0) return null;
  return { available: true, total, display: displayDollars(total), currency: null };
}

function readSeats(record: Record<string, unknown>): number | null {
  for (const key of ["seatsRemaining", "goWildFareSeatsRemaining", "standardFareSeatsRemaining"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function readStops(itinerary: Record<string, unknown>, legCount: number): number | null {
  if (typeof itinerary.stopCount === "number" && Number.isFinite(itinerary.stopCount)) return itinerary.stopCount;
  if (typeof itinerary.stops === "number" && Number.isFinite(itinerary.stops)) return itinerary.stops;
  if (legCount > 0) return Math.max(0, legCount - 1);
  return null;
}

function isBlockedPage(url: string, html: string): boolean {
  if (CHALLENGE_TEXT.test(html) && !html.includes("FlightData")) return true;
  if (isHomepage(url) && !html.includes("FlightData")) return true;
  return false;
}

function onResultsPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("flyfrontier.com") && /\/Flight\/Select\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isHomepage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.flyfrontier.com" && (parsed.pathname === "/" || parsed.pathname === "");
  } catch {
    return false;
  }
}

function decodeFlightData(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function localTimestamp(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3] ?? "00"}`;
}

function minutesBetween(departure: string, arrival: string): number | null {
  const start = stampMinutes(departure);
  const end = stampMinutes(arrival);
  if (start == null || end == null || end < start) return null;
  return end - start;
}

function stampMinutes(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])) / 60000);
}

function numberText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}
