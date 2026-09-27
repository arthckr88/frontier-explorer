export type AvailabilityStatus = "ok" | "blocked" | "unauthorized" | "network_error" | "parse_error";

export type AvailabilityQuery = {
  origin: string;
  destination: string;
  date: string;
};

export type FareQuote = {
  amount: number | null;
  currency: string | null;
  seatsRemaining: number | null;
};

export type OtherFare = FareQuote & {
  key: string;
};

export type AvailabilitySegment = {
  origin: string | null;
  destination: string | null;
  flightNumber: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
};

export type AvailabilityFlight = {
  flightNumber: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  stops: number | null;
  segments: AvailabilitySegment[];
  standard: FareQuote;
  discountDen: FareQuote;
  goWild: FareQuote;
  otherFares: OtherFare[];
};

export type AvailabilitySearchResult = {
  status: AvailabilityStatus;
  origin: string;
  destination: string;
  date: string;
  httpStatus: number | null;
  flights: AvailabilityFlight[];
};

export type AvailabilityHttpRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

export type AvailabilityTransportResponse = {
  status: number;
  contentType: string | null;
  body: string;
};

export type AvailabilityTransport = (request: AvailabilityHttpRequest) => Promise<AvailabilityTransportResponse>;

export const AVAILABILITY_SOURCE = "frontier_availability" as const;

export const AVAILABILITY_ENDPOINT =
  "https://mtier.flyfrontier.com/flightavailabilityssv/FlightAvailabilitySimpleSearch";
