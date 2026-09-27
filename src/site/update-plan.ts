import {
  CONFIRMED_HORIZON_DAYS,
  DISCOVERY_AIRPORTS,
  MAX_UPDATE_REQUESTS,
  PRIORITY_CORRIDORS,
  PRIORITY_HORIZON_DAYS,
  addDays,
  datesBetween,
  pairKey,
} from "@/site/view";

export type BlockMeta = { attempts: number; lastAttempt: string };

export type PlannedCheck = {
  origin: string;
  destination: string;
  date: string;
  reason: "discovery" | "backfill" | "extend-priority" | "extend-confirmed" | "listed-probe" | "retry-blocked";
};

export type PlanInput = {
  today: string;
  flights: Array<{ origin: string; destination: string; date: string }>;
  checked?: string[];
  blocked?: string[];
  blockMeta?: Record<string, BlockMeta>;
  routes?: Array<{ origin: string; destination: string; provenance?: string }>;
  limit?: number;
};

const REASON_RANK: Record<PlannedCheck["reason"], number> = {
  discovery: 0,
  backfill: 1,
  "extend-priority": 2,
  "extend-confirmed": 3,
  "listed-probe": 4,
  "retry-blocked": 5,
};

export function planScheduleChecks(input: PlanInput): PlannedCheck[] {
  const limit = input.limit ?? MAX_UPDATE_REQUESTS;
  const checked = new Set(input.checked ?? []);
  const blocked = new Set(input.blocked ?? []);
  const meta = input.blockMeta ?? {};
  const flightsByPair = new Map<string, string[]>();
  for (const flight of input.flights) {
    const key = pairKey(flight.origin, flight.destination);
    const dates = flightsByPair.get(key) ?? [];
    dates.push(flight.date);
    flightsByPair.set(key, dates);
  }
  const evidence = new Map<string, string[]>();
  const addEvidence = (origin: string, destination: string, date: string) => {
    const key = pairKey(origin, destination);
    const dates = evidence.get(key) ?? [];
    dates.push(date);
    evidence.set(key, dates);
  };
  for (const flight of input.flights) addEvidence(flight.origin, flight.destination, flight.date);
  for (const key of [...checked, ...blocked]) {
    const parsed = parseKey(key);
    if (parsed) addEvidence(parsed.origin, parsed.destination, parsed.date);
  }

  const context = { flightsByPair, evidence, checked, blocked, meta, today: input.today };
  const corridors = [...PRIORITY_CORRIDORS].sort((left, right) => comparePairs(left[0], left[1], right[0], right[1]));
  const corridorItems = corridors
    .map(([origin, destination]) => nextDateForPair(origin, destination, true, context))
    .filter((item): item is PlannedCheck => item !== null)
    .sort(comparePlans);
  const chosen: PlannedCheck[] = [];
  const seen = new Set<string>();
  for (const item of corridorItems) {
    if (chosen.length >= limit) break;
    const key = `${item.origin}|${item.destination}|${item.date}`;
    if (seen.has(key)) continue;
    if (item.reason === "retry-blocked" && chosen.filter((row) => row.reason === "retry-blocked").length >= 4) continue;
    if (!isCorridor(item.origin, item.destination)) continue;
    seen.add(key);
    chosen.push(item);
  }
  return chosen;
}

export function applyDayResult(
  schedule: {
    flights: Array<{ origin: string; destination: string; date: string; flightNumber: string; departureLocal: string }>;
    checked: string[];
    blocked: string[];
    blockMeta?: Record<string, BlockMeta>;
    refreshedAt?: string | null;
  },
  request: { origin: string; destination: string; date: string },
  result: { ok: true; flights: Array<{ origin: string; destination: string; date: string; flightNumber: string; departureLocal: string }> } | { ok: false; blocked: boolean },
  today: string,
  retrievedAt: string,
): void {
  const key = `${request.origin}|${request.destination}|${request.date}`;
  schedule.blockMeta ??= {};
  if (!result.ok) {
    if (result.blocked) {
      if (!schedule.blocked.includes(key)) schedule.blocked.push(key);
      schedule.blocked.sort();
      const previous = schedule.blockMeta[key];
      schedule.blockMeta[key] = { attempts: (previous?.attempts ?? 0) + 1, lastAttempt: today };
    }
    return;
  }
  schedule.blocked = schedule.blocked.filter((item) => item !== key);
  delete schedule.blockMeta[key];
  if (!schedule.checked.includes(key)) schedule.checked.push(key);
  schedule.checked.sort();
  schedule.refreshedAt = retrievedAt;
}

type PlanContext = {
  flightsByPair: Map<string, string[]>;
  evidence: Map<string, string[]>;
  checked: Set<string>;
  blocked: Set<string>;
  meta: Record<string, BlockMeta>;
  today: string;
};

function nextDateForPair(origin: string, destination: string, priority: boolean, context: PlanContext): PlannedCheck | null {
  const horizon = addDays(context.today, priority ? PRIORITY_HORIZON_DAYS : CONFIRMED_HORIZON_DAYS);
  if (!horizon) return null;
  const key = pairKey(origin, destination);
  const known = [...new Set(context.evidence.get(key) ?? [])].sort();
  const flightDates = [...new Set(context.flightsByPair.get(key) ?? [])].sort();
  const classify = (date: string, reason: PlannedCheck["reason"]): PlannedCheck | null => {
    if (date < context.today || date > horizon) return null;
    const id = `${origin}|${destination}|${date}`;
    if (context.checked.has(id)) return null;
    if (context.blocked.has(id)) {
      const info = context.meta[id];
      if (info && info.attempts >= 4) return null;
      if (info && !retryDue(info, context.today)) return null;
      return { origin, destination, date, reason: "retry-blocked" };
    }
    return { origin, destination, date, reason };
  };
  if (known.length >= 2) {
    const start = known[0] && known[0] > context.today ? known[0] : context.today;
    const end = known[known.length - 1] ?? context.today;
    for (const date of datesBetween(start, end)) {
      const hole = classify(date, "backfill");
      if (hole) return hole;
    }
  }
  if (known.length === 0 && flightDates.length === 0) {
    return classify(context.today, priority ? "discovery" : "extend-confirmed");
  }
  const latest = known[known.length - 1] ?? flightDates[flightDates.length - 1] ?? context.today;
  const next = addDays(latest, 1);
  if (next) {
    const extended = classify(next, priority ? "extend-priority" : "extend-confirmed");
    if (extended) return extended;
  }
  for (const date of datesBetween(context.today, horizon)) {
    const forward = classify(date, priority ? "extend-priority" : "extend-confirmed");
    if (forward) return forward;
  }
  return null;
}

function comparePlans(left: PlannedCheck, right: PlannedCheck): number {
  const reason = REASON_RANK[left.reason] - REASON_RANK[right.reason];
  if (reason !== 0) return reason;
  return comparePairs(left.origin, left.destination, right.origin, right.destination) || left.date.localeCompare(right.date);
}

function retryDue(info: BlockMeta | undefined, today: string): boolean {
  if (!info) return true;
  const wait = Math.min(8, 2 ** Math.max(0, info.attempts - 1));
  const due = addDays(info.lastAttempt, wait);
  return Boolean(due && today >= due);
}

function isCorridor(origin: string, destination: string): boolean {
  return PRIORITY_CORRIDORS.some(([from, to]) => from === origin && to === destination);
}

function comparePairs(origin: string, destination: string, otherOrigin: string, otherDestination: string): number {
  const left = DISCOVERY_AIRPORTS.indexOf(origin as (typeof DISCOVERY_AIRPORTS)[number]);
  const right = DISCOVERY_AIRPORTS.indexOf(otherOrigin as (typeof DISCOVERY_AIRPORTS)[number]);
  const originRank = (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
  if (originRank !== 0) return originRank;
  const leftDest = DISCOVERY_AIRPORTS.indexOf(destination as (typeof DISCOVERY_AIRPORTS)[number]);
  const rightDest = DISCOVERY_AIRPORTS.indexOf(otherDestination as (typeof DISCOVERY_AIRPORTS)[number]);
  return (leftDest === -1 ? 99 : leftDest) - (rightDest === -1 ? 99 : rightDest);
}

function parseKey(key: string): { origin: string; destination: string; date: string } | null {
  const [origin, destination, date] = key.split("|");
  if (!origin || !destination || !date) return null;
  return { origin, destination, date };
}
