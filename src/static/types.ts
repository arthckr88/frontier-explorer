import type { FareSegment } from "@/site/itinerary";
import type { BrowserFareRecord, NetworkArtifact, RouteChange, RouteChangeFile } from "@/site/network";

export type AirportRecord = {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string | null;
  region: string;
};

export type PriceHistoryRow = {
  origin: string;
  destination: string;
  date: string;
  flightNumber: string;
  departureLocal: string;
  fareType: string;
  price: number;
  observedAt: string;
};

export type HistoricalMetrics = {
  frequency: {
    current: string;
    currentNote: string;
    historicalSource: string;
    historicalUrl: string;
    historicalPeriod: string;
    historicalNote: string;
    routes: { origin: string; destination: string; departures: number; perWeek: number }[];
  };
  popularity: {
    source: string;
    sourceUrl: string;
    period: string;
    periodStart: string;
    periodEnd: string;
    passengersStored: boolean;
    note: string;
    routes: { origin: string; destination: string; passengers: number; departuresPerformed: number }[];
  };
};

export type StaticCatalog = {
  network: NetworkArtifact;
  fares: BrowserFareRecord[];
  changes: RouteChangeFile;
  priceHistory: PriceHistoryRow[];
  airports: AirportRecord[];
  historical?: HistoricalMetrics | null;
};

export type DisplayFare = {
  total: number;
  display: number;
  currency: string;
};

export type StoredFlight = {
  id: string;
  origin: string;
  destination: string;
  date: string;
  flightNumber: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  stops: number;
  segments?: FareSegment[];
  legacyPartial?: boolean;
  standard: DisplayFare | null;
  discountDen: DisplayFare | null;
  goWild: DisplayFare | null;
  checkedAt: string | null;
  redEye: boolean;
  connections?: { airport: string; minutes: number }[];
};

export type FareQuery = {
  origin: string;
  destination: string;
  date: string;
  maxStops: number;
  maxDuration: number | null;
  depart: "" | "morning" | "afternoon" | "evening";
  arrive: "" | "morning" | "afternoon" | "evening";
  sort: "stops" | "duration" | "depart";
  excludeRedEyes: boolean;
  via?: string;
  layover?: "" | "short" | "normal" | "long";
};

export type NetworkPath = {
  airports: string[];
  stops: number;
  kind: "timed" | "possible";
  label: string;
  id?: string;
  itinerary?: StoredFlight;
};

export type FareLookupResult = {
  flights: StoredFlight[];
  paths: NetworkPath[];
  officialNonstop: boolean;
  message: string | null;
};

export type { BrowserFareRecord, NetworkArtifact, RouteChange, RouteChangeFile };
