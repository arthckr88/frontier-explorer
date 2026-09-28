import type { FareSegment } from "@/site/itinerary";

export type BrowserStatus = "ok" | "blocked" | "no_flights" | "parse_error" | "navigation_error";

export type BrowserQuery = {
  origin: string;
  destination: string;
  date: string;
};

export type BrowserFare = {
  available: boolean;
  total: number;
  display: number;
  currency: string | null;
};

export type BrowserFlight = {
  carrier: string | null;
  flightNumber: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number | null;
  stops: number | null;
  segments: FareSegment[];
  fares: {
    standard: BrowserFare | null;
    discountDen: BrowserFare | null;
    goWild: BrowserFare | null;
  };
  seatsRemaining: number | null;
};

export type BrowserResult = {
  query: BrowserQuery;
  status: BrowserStatus;
  source: "frontier_browser";
  retrievedAt: string;
  flights: BrowserFlight[];
};

export type PageCapture = {
  url: string;
  html: string;
  httpStatus: number | null;
};

export const BROWSER_SOURCE = "frontier_browser" as const;
export const FARE_TTL_NEAR_MS = 10 * 60 * 1000;
export const FARE_TTL_LATER_MS = 20 * 60 * 1000;
export const SCHEDULE_META_TTL_MS = 12 * 60 * 60 * 1000;
export const SEARCH_PAUSE_MS = 15_000;
export const MAX_QUEUE = 5;
export const BOOKING_HOME = "https://www.flyfrontier.com/";
