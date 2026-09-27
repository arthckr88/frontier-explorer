import type { AvailabilitySearchResult } from "@/site/availability/types";

export type AvailabilityRouteEvent = {
  type: "possible_gap" | "observed" | "blocked" | "empty";
  origin: string;
  destination: string;
  date: string;
  detail: string;
};

/** One date with no flight is a possible gap. It is not a route discontinuation. */
export function availabilityRouteEvent(
  previous: AvailabilitySearchResult | null,
  next: AvailabilitySearchResult,
): AvailabilityRouteEvent {
  const base = { origin: next.origin, destination: next.destination, date: next.date };
  if (next.status !== "ok") {
    return {
      ...base,
      type: "blocked",
      detail: `${next.origin} to ${next.destination} on ${next.date} is ${next.status}. That date stays unknown.`,
    };
  }
  if ((previous?.status === "ok" && previous.flights.length > 0) && next.flights.length === 0) {
    return {
      ...base,
      type: "possible_gap",
      detail: `Checked ${next.date} and Frontier returned no flight. This date is a possible gap.`,
    };
  }
  if (next.flights.length > 0) {
    const count = next.flights.length;
    return {
      ...base,
      type: "observed",
      detail: `${count} flight${count === 1 ? "" : "s"} returned for ${next.date}.`,
    };
  }
  return {
    ...base,
    type: "empty",
    detail: `Checked ${next.date} and Frontier returned no flight.`,
  };
}
