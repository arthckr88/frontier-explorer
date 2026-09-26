import { daysBetween } from "@/lib/utils";
import type { RouteProjection } from "@/types/domain";

export function timingCopy(
  route: Pick<
    RouteProjection,
    | "status"
    | "endConfirmed"
    | "announcedStartDate"
    | "announcedEndDate"
    | "lastScheduledDeparture"
    | "launchUnverified"
  >,
  today: string,
): string | null {
  if (route.launchUnverified) {
    return "Announced launch date has passed and no schedule observation confirms service. Flagged for reconciliation.";
  }

  if (
    (route.status === "ANNOUNCED" || route.status === "UPCOMING") &&
    route.announcedStartDate &&
    route.announcedStartDate >= today
  ) {
    const days = daysBetween(today, route.announcedStartDate);
    if (days === 0) return "Starts today";
    return `Starts in ${days} ${days === 1 ? "day" : "days"}`;
  }

  if (route.status === "ENDING_SOON" && route.endConfirmed) {
    const end = route.announcedEndDate ?? route.lastScheduledDeparture;
    if (!end || end < today) return "Confirmed discontinuation";
    const days = daysBetween(today, end);
    if (days === 0) return "Confirmed discontinuation is today";
    return `Route ends in ${days} ${days === 1 ? "day" : "days"}`;
  }

  if (
    route.status === "ENDING_SOON" &&
    !route.endConfirmed &&
    route.lastScheduledDeparture &&
    route.lastScheduledDeparture >= today
  ) {
    const days = daysBetween(today, route.lastScheduledDeparture);
    return `Last currently observed scheduled service in ${days} ${days === 1 ? "day" : "days"}`;
  }

  if (route.status === "POSSIBLY_ENDING" || route.status === "STALE") {
    return "No upcoming service in the latest check. This is not a confirmed end.";
  }

  if (route.status === "ENDED" && route.endConfirmed) return "Confirmed discontinuation";
  if (route.status === "ENDED") return "No service currently loaded after the last observed date.";
  return null;
}

export function endExplanation(route: Pick<RouteProjection, "endConfirmed" | "status">): string {
  if (route.endConfirmed) return "Confirmed discontinuation";
  if (route.status === "ENDED" || route.status === "ENDING_SOON" || route.status === "POSSIBLY_ENDING") {
    return "No service currently loaded after this date.";
  }
  return "No confirmed end date.";
}
