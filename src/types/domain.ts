export const ROUTE_STATUSES = [
  "ANNOUNCED",
  "UPCOMING",
  "ACTIVE",
  "SEASONAL",
  "ENDING_SOON",
  "POSSIBLY_ENDING",
  "PAUSED",
  "ENDED",
  "STALE",
  "UNKNOWN",
] as const;

export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const CONFIDENCE_LEVELS = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "CONFLICTING",
  "UNKNOWN",
] as const;

export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CHANGE_TYPES = [
  "NEW_ROUTE",
  "ROUTE_RETURNING",
  "ROUTE_STARTED",
  "FREQUENCY_INCREASED",
  "FREQUENCY_DECREASED",
  "SCHEDULE_SHIFTED",
  "POSSIBLE_ROUTE_END",
  "ROUTE_END_CONFIRMED",
  "SEASONAL_PAUSE",
  "ROUTE_RETURNED",
  "SOURCE_DISAGREEMENT",
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export type SourceKind =
  | "frontier_schedule"
  | "frontier_route_page"
  | "announcement"
  | "airport_press"
  | "timetable_api"
  | "bts"
  | "program";

export type ObservationKind =
  | "announcement"
  | "schedule_snapshot"
  | "marketed_sample"
  | "popularity";

export type AnnouncementKind =
  | "launch"
  | "end"
  | "seasonal"
  | "frequency"
  | "return"
  | "other";

export type FlightPoint = {
  date: string;
  departureLocal?: string;
  arrivalLocal?: string;
  flightNumber?: string;
};

export type Observation = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceTier: 1 | 2 | 3 | 4;
  sourceKind: SourceKind;
  url?: string;
  retrievedAt: string;
  externalId: string;
  origin: string;
  destination: string;
  kind: ObservationKind;
  announcedStart?: string | null;
  announcedEnd?: string | null;
  announcementKind?: AnnouncementKind;
  seasonal?: boolean;
  announcedFrequencyPerWeek?: number | null;
  frequencyText?: string | null;
  flights?: FlightPoint[];
  windowStart?: string;
  windowEnd?: string;
  successful?: boolean;
  frequencyPerWeek?: number | null;
  marketedDate?: string | null;
  marketedFareText?: string | null;
  passengers?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodLabel?: string | null;
  title?: string | null;
};

export type Disagreement = {
  field: string;
  values: { sourceId: string; sourceName: string; value: string }[];
};

export type SourceEvidence = {
  sourceId: string;
  sourceName: string;
  sourceTier: number;
  sourceKind: SourceKind;
  url?: string;
  retrievedAt: string;
  kind: ObservationKind;
};

export type RouteProjection = {
  origin: string;
  destination: string;
  status: RouteStatus;
  confidence: Confidence;
  endConfirmed: boolean;
  reasons: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  firstScheduledDeparture: string | null;
  lastScheduledDeparture: string | null;
  announcedStartDate: string | null;
  announcedEndDate: string | null;
  announcedFrequencyPerWeek: number | null;
  currentFrequencyPerWeek: number | null;
  previousFrequencyPerWeek: number | null;
  scheduleDays: number[];
  scheduleHorizon: string | null;
  lastVerifiedAt: string | null;
  disagreements: Disagreement[];
  launchUnverified: boolean;
  suspectedEndDate: string | null;
  seasonal: boolean;
  latestMarketedDeparture: string | null;
  sources: SourceEvidence[];
};

export type RouteChange = {
  origin: string;
  destination: string;
  type: ChangeType;
  detectedAt: string;
  summary: string;
  confidence: Confidence;
  before: RouteProjection | null;
  after: RouteProjection;
};

export type FareMode = "standard" | "discount_den" | "gowild";

export type UserPreferences = {
  homeAirports: string[];
  homePriority: string[];
  heavyInterest: string[];
  includeNearby: boolean;
  excludeRedEyes: boolean;
  maxStops: number;
  minConnectionMinutes: number;
  allowLongConnection: boolean;
  allowIntentionalStopover: boolean;
  allowMultiDay: boolean;
  preferVegasStopover: boolean;
  maxJourneyHours: number;
  fareMode: FareMode;
  programs: { gowild: boolean; discountDen: boolean };
};
