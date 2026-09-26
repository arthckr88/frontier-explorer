import { pairKey, deriveRoute } from "@/server/reconciliation/status";
import type { Thresholds } from "@/server/reconciliation/thresholds";
import type {
  ChangeType,
  Observation,
  RouteChange,
  RouteProjection,
} from "@/types/domain";

function summarize(type: ChangeType, next: RouteProjection): string {
  const pair = `${next.origin} → ${next.destination}`;
  switch (type) {
    case "NEW_ROUTE":
      return `${pair} was observed for the first time (${next.status}).`;
    case "ROUTE_RETURNING":
      return `${pair} has scheduled service again after being ended or paused.`;
    case "ROUTE_STARTED":
      return `${pair} has moved from announced or upcoming into active service.`;
    case "FREQUENCY_INCREASED":
      return `${pair} scheduled frequency increased to ${next.currentFrequencyPerWeek ?? "?"} departures/week.`;
    case "FREQUENCY_DECREASED":
      return `${pair} scheduled frequency decreased to ${next.currentFrequencyPerWeek ?? "?"} departures/week.`;
    case "SCHEDULE_SHIFTED":
      return `${pair} operating days changed.`;
    case "POSSIBLE_ROUTE_END":
      return `${pair} has no future flights in the latest check. This is not a confirmed end.`;
    case "ROUTE_END_CONFIRMED":
      return `${pair} has a confirmed discontinuation.`;
    case "SEASONAL_PAUSE":
      return `${pair} is in a seasonal gap and was not marked ended.`;
    case "ROUTE_RETURNED":
      return `${pair} has future flights again after a possible end.`;
    case "SOURCE_DISAGREEMENT":
      return `${pair} has conflicting source data. Neither side is treated as confirmed.`;
    default:
      return pair;
  }
}

export function detectChanges(
  previous: RouteProjection | null,
  next: RouteProjection,
  detectedAt: string,
): RouteChange[] {
  const types: ChangeType[] = [];
  if (!previous) {
    types.push("NEW_ROUTE");
    if (next.confidence === "CONFLICTING") types.push("SOURCE_DISAGREEMENT");
  } else {
    if (next.confidence === "CONFLICTING" && previous.confidence !== "CONFLICTING") {
      types.push("SOURCE_DISAGREEMENT");
    }
    if (
      (previous.status === "ANNOUNCED" || previous.status === "UPCOMING") &&
      next.status === "ACTIVE"
    ) {
      types.push("ROUTE_STARTED");
    }
    if (
      (previous.status === "ENDED" || previous.status === "PAUSED") &&
      (next.status === "ACTIVE" || next.status === "UPCOMING")
    ) {
      types.push("ROUTE_RETURNING");
    }
    if (previous.status === "POSSIBLY_ENDING" && next.status === "ACTIVE") {
      types.push("ROUTE_RETURNED");
    }
    if (previous.status !== "POSSIBLY_ENDING" && next.status === "POSSIBLY_ENDING") {
      types.push("POSSIBLE_ROUTE_END");
    }
    if (previous.status !== "ENDED" && next.status === "ENDED" && next.endConfirmed) {
      types.push("ROUTE_END_CONFIRMED");
    }
    if (previous.status === "ACTIVE" && next.status === "SEASONAL") {
      types.push("SEASONAL_PAUSE");
    }
    if (
      previous.currentFrequencyPerWeek != null &&
      next.currentFrequencyPerWeek != null &&
      next.currentFrequencyPerWeek > previous.currentFrequencyPerWeek
    ) {
      types.push("FREQUENCY_INCREASED");
    }
    if (
      previous.currentFrequencyPerWeek != null &&
      next.currentFrequencyPerWeek != null &&
      next.currentFrequencyPerWeek < previous.currentFrequencyPerWeek
    ) {
      types.push("FREQUENCY_DECREASED");
    }
    if (
      previous.scheduleDays.length > 0 &&
      next.scheduleDays.length > 0 &&
      previous.scheduleDays.join(",") !== next.scheduleDays.join(",")
    ) {
      types.push("SCHEDULE_SHIFTED");
    }
  }

  return types.map((type) => ({
    origin: next.origin,
    destination: next.destination,
    type,
    detectedAt,
    summary: summarize(type, next),
    confidence: next.confidence,
    before: previous,
    after: next,
  }));
}

function withFrequencyMemory(previous: RouteProjection | null, next: RouteProjection): RouteProjection {
  if (!previous) return next;
  if (previous.currentFrequencyPerWeek !== next.currentFrequencyPerWeek) {
    return { ...next, previousFrequencyPerWeek: previous.currentFrequencyPerWeek };
  }
  return { ...next, previousFrequencyPerWeek: previous.previousFrequencyPerWeek };
}

export function reconcileNetwork(input: {
  observations: Observation[];
  previous: RouteProjection[];
  now: string;
  thresholds?: Partial<Thresholds>;
}): { projections: RouteProjection[]; changes: RouteChange[] } {
  const previousByKey = new Map(
    input.previous.map((route) => [pairKey(route.origin, route.destination), route]),
  );
  const grouped = new Map<string, Observation[]>();
  for (const observation of input.observations) {
    if (
      observation.kind !== "announcement" &&
      observation.kind !== "schedule_snapshot" &&
      observation.kind !== "marketed_sample"
    ) {
      continue;
    }
    const key = pairKey(observation.origin, observation.destination);
    const list = grouped.get(key) ?? [];
    list.push(observation);
    grouped.set(key, list);
  }

  const projections: RouteProjection[] = [];
  const changes: RouteChange[] = [];

  for (const [key, observations] of grouped) {
    const previous = previousByKey.get(key) ?? null;
    const derived = deriveRoute({
      origin: observations[0]?.origin ?? key.slice(0, 3),
      destination: observations[0]?.destination ?? key.slice(4),
      now: input.now,
      observations,
      previous,
      thresholds: input.thresholds,
    });
    const next = withFrequencyMemory(previous, derived);
    projections.push(next);
    changes.push(...detectChanges(previous, next, input.now));
    previousByKey.delete(key);
  }

  for (const kept of previousByKey.values()) {
    projections.push(kept);
  }

  projections.sort((a, b) => pairKey(a.origin, a.destination).localeCompare(pairKey(b.origin, b.destination)));
  return { projections, changes };
}
