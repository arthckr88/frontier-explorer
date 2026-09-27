import { normalizeAvailabilityPayload } from "@/site/availability/normalize";
import {
  AVAILABILITY_ENDPOINT,
  type AvailabilityHttpRequest,
  type AvailabilityQuery,
  type AvailabilitySearchResult,
  type AvailabilityStatus,
  type AvailabilityTransport,
} from "@/site/availability/types";

const USER_AGENT = "frontier-explorer-availability/0.1";

export function availabilityRequest(query: AvailabilityQuery): AvailabilityHttpRequest {
  return {
    url: AVAILABILITY_ENDPOINT,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({
      flightAvailabilityRequestModel: {
        passengers: { types: [{ type: "ADT", count: 1 }], residentCountry: "US" },
        filters: {
          maxConnections: 20,
          fareInclusionType: "Default",
          type: "All",
          includeAllotments: true,
          bundleControlFilter: "2",
        },
        codes: { currencyCode: "USD" },
        origin: query.origin,
        destination: query.destination,
        beginDate: query.date,
      },
    }),
  };
}

export function statusFromHttp(status: number): AvailabilityStatus | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return "unauthorized";
  if (status === 403 || status === 406 || status === 429 || (status >= 400 && status < 500)) return "blocked";
  return "network_error";
}

export class FrontierAvailabilityProvider {
  constructor(private readonly transport: AvailabilityTransport) {}

  async search(query: AvailabilityQuery): Promise<AvailabilitySearchResult> {
    const blank = (status: AvailabilityStatus, httpStatus: number | null): AvailabilitySearchResult => ({
      status,
      origin: query.origin,
      destination: query.destination,
      date: query.date,
      httpStatus,
      flights: [],
    });
    let response;
    try {
      response = await this.transport(availabilityRequest(query));
    } catch {
      return blank("network_error", null);
    }
    const mapped = statusFromHttp(response.status);
    if (mapped) return blank(mapped, response.status);
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      return blank("parse_error", response.status);
    }
    const normalized = normalizeAvailabilityPayload(payload);
    if (!normalized.ok) return blank("parse_error", response.status);
    return {
      status: "ok",
      origin: query.origin,
      destination: query.destination,
      date: query.date,
      httpStatus: response.status,
      flights: normalized.flights,
    };
  }
}
