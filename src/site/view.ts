/** Browser-safe schedule vocabulary. No Luxon import: GitHub Pages loads this file as-is. */

export const SOURCE_NAME = "Frontier public booking observations";
export const SOURCE_URL = "https://booking.flyfrontier.com/";
export const SCHEDULE_ZONE = "America/Los_Angeles";
export const NEAR_TERM_DAYS = 14;
export const PRIORITY_HORIZON_DAYS = 45;
export const CONFIRMED_HORIZON_DAYS = 21;
export const MAX_UPDATE_REQUESTS = 20;

export const PRIORITY_AIRPORTS = ["OAK", "SFO", "LAS", "LAX", "BUR", "SAN", "ONT", "SNA"] as const;

/** Discovery order when the hourly budget cannot cover every pair. */
export const DISCOVERY_AIRPORTS = ["OAK", "SFO", "LAS", "LAX", "BUR", "SAN", "ONT", "SNA"] as const;

/** Changes and home-panel order. */
export const CHANGE_PRIORITY = ["OAK", "SFO", "LAS", "LAX", "BUR", "SNA", "ONT", "SAN"] as const;

export const HOME_AIRPORTS = ["OAK", "SFO", "LAS", "LAX", "BUR", "SNA", "ONT", "SAN"] as const;
export const BAY_ORIGINS = ["OAK", "SFO"] as const;
export const SOCAL_DESTINATIONS = ["LAX", "BUR", "SNA", "ONT", "SAN"] as const;

export const PRIORITY_CORRIDORS: ReadonlyArray<readonly [string, string]> = [
  ["OAK", "LAS"],
  ["LAS", "OAK"],
  ["SFO", "LAS"],
  ["LAS", "SFO"],
  ["LAS", "LAX"],
  ["LAX", "LAS"],
  ["LAS", "BUR"],
  ["BUR", "LAS"],
  ["SFO", "LAX"],
  ["LAX", "SFO"],
  ["OAK", "LAX"],
  ["LAX", "OAK"],
  ["SFO", "BUR"],
  ["BUR", "SFO"],
  ["OAK", "BUR"],
  ["BUR", "OAK"],
  ["SFO", "ONT"],
  ["ONT", "SFO"],
  ["OAK", "ONT"],
  ["ONT", "OAK"],
  ["SFO", "SNA"],
  ["SNA", "SFO"],
  ["SAN", "LAS"],
  ["LAS", "SAN"],
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type CheckState = "flights_found" | "checked_empty" | "blocked" | "unchecked";
export type RouteStatus = "observed" | "future" | "possible_gap" | "unknown" | "blocked";
export type ArcKind = "near_term" | "future_only" | "none";
export type LineWeight = 0 | 1 | 2;

export type Observation = {
  origin: string;
  destination: string;
  date: string;
  flightNumber: string;
  departureLocal: string;
  arrivalLocal: string;
  departureUtc: string;
  arrivalUtc: string;
  source: string;
  retrievedAt: string | null;
};

export type Check = {
  origin: string;
  destination: string;
  date: string;
  state: CheckState;
};

export type NextDeparture = {
  date: string;
  flightNumber: string;
  departureLocal: string;
  arrivalLocal: string;
};

export type RouteSummary = {
  origin: string;
  destination: string;
  status: RouteStatus;
  observedDates: string[];
  firstObservedDate: string | null;
  lastObservedDate: string | null;
  futureDepartureCount: number;
  futureCheckedDates: number;
  departuresPhrase: string;
  weekdayLabel: string;
  flightNumbers: string[];
  nextDeparture: NextDeparture | null;
  emptyDates: string[];
  blockedDates: string[];
  uncheckedDates: string[];
  lastCheckDate: string | null;
  gapNote: string | null;
  coverageNote: string;
};

export type WatchSignal = "possible_gap" | "coverage_problem" | "blocked" | "future" | "observed";

export type Watch = {
  origin: string;
  destination: string;
  signal: WatchSignal;
  text: string;
};

export type DateVerdictKind = "flight_found" | "checked_empty" | "blocked" | "not_checked";

export type DateVerdict = {
  kind: DateVerdictKind;
  flights: Observation[];
  sentence: string;
};

export function scheduleToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not resolve the schedule date.");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function compareIso(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function pairKey(origin: string, destination: string): string {
  return `${origin}|${destination}`;
}

export function weekdayName(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return WEEKDAYS[date.getUTCDay()] ?? "";
}

export function priorityRank(code: string, order: readonly string[] = CHANGE_PRIORITY): number {
  const index = order.indexOf(code);
  return index === -1 ? order.length + 1 : index;
}

export function isPriorityCorridor(origin: string, destination: string): boolean {
  return PRIORITY_CORRIDORS.some(([from, to]) => from === origin && to === destination);
}

export function datesBetween(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  let cursor: string | null = start;
  while (cursor && cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
    if (dates.length > 400) break;
  }
  return dates;
}

export function departuresPhrase(departureCount: number, checkedDates: number): string {
  const departures = `${departureCount} departure${departureCount === 1 ? "" : "s"}`;
  const checked = `${checkedDates} checked date${checkedDates === 1 ? "" : "s"}`;
  return `${departures} across ${checked}.`;
}

export function weekdayLabel(flightDates: string[], checkedDates: number): string {
  if (!flightDates.length) return "No weekday pattern. No flight dates are loaded for this window.";
  const present = new Set(flightDates.map(weekdayName).filter(Boolean));
  const names = WEEKDAYS.filter((name) => present.has(name));
  const list = names.join(", ");
  if (checkedDates < 7) {
    return `${list} observed. ${checkedDates} date${checkedDates === 1 ? "" : "s"} checked, so this is not a weekly frequency.`;
  }
  return `${list} observed on the checked dates. This is not a published weekly frequency.`;
}

export function formatDateList(dates: string[]): string {
  const sorted = [...dates].sort(compareIso);
  if (sorted.length <= 4) return sorted.join(", ");
  return `${sorted.slice(0, 3).join(", ")}, and ${sorted.length - 3} more through ${sorted[sorted.length - 1]}`;
}

export function gapNote(observedDates: string[], emptyDates: string[], uncheckedDates: string[]): string | null {
  if (!observedDates.length || !emptyDates.length) return null;
  const lastObserved = [...observedDates].sort(compareIso).at(-1);
  if (!lastObserved) return null;
  const laterEmpty = emptyDates.filter((date) => date > lastObserved).sort(compareIso);
  if (!laterEmpty.length) return null;
  const latestEmpty = laterEmpty[laterEmpty.length - 1] ?? lastObserved;
  const incomplete = uncheckedDates.filter((date) => date > lastObserved && date <= latestEmpty).sort(compareIso);
  const observed = `Observed through ${lastObserved}.`;
  const empty = `Later checks returned no nonstop on ${formatDateList(laterEmpty)}.`;
  if (incomplete.length) return `${observed} ${empty} ${formatDateList(incomplete)} coverage incomplete.`;
  return `${observed} ${empty} Those dates were checked. That is negative evidence for those dates only.`;
}

export function classifyArc(observedDates: string[], today: string): ArcKind {
  const upcoming = observedDates.filter((date) => date >= today).sort(compareIso);
  if (!upcoming.length) return "none";
  const nearEnd = addDays(today, NEAR_TERM_DAYS);
  if (!nearEnd) return "future_only";
  return upcoming.some((date) => date <= nearEnd) ? "near_term" : "future_only";
}

export function lineWeight(futureDepartureCount: number, futureCheckedDates: number, arc: ArcKind): LineWeight {
  if (arc === "none" || arc === "future_only") return 0;
  if (futureCheckedDates < 3) return 0;
  if (futureCheckedDates === 0) return 0;
  const average = futureDepartureCount / futureCheckedDates;
  if (average >= 1.5) return 2;
  if (futureDepartureCount > 0) return 1;
  return 0;
}

export function describePair(
  origin: string,
  destination: string,
  observations: Observation[],
  checks: Check[],
  today: string,
): RouteSummary {
  const flights = observations
    .filter((flight) => flight.origin === origin && flight.destination === destination)
    .sort((left, right) => compareIso(left.date, right.date) || left.departureLocal.localeCompare(right.departureLocal));
  const pairChecks = checks
    .filter((check) => check.origin === origin && check.destination === destination)
    .sort((left, right) => compareIso(left.date, right.date));
  const observedDates = [...new Set(flights.map((flight) => flight.date))].sort(compareIso);
  const emptyDates = pairChecks.filter((check) => check.state === "checked_empty").map((check) => check.date);
  const blockedDates = pairChecks.filter((check) => check.state === "blocked").map((check) => check.date);
  const uncheckedDates = pairChecks.filter((check) => check.state === "unchecked").map((check) => check.date);
  const futureFlights = flights.filter((flight) => flight.date >= today);
  const futureCheckedDates = pairChecks.filter(
    (check) => check.date >= today && (check.state === "flights_found" || check.state === "checked_empty"),
  ).length;
  const futureDepartureCount = futureFlights.length;
  const futureFlightDates = [...new Set(futureFlights.map((flight) => flight.date))];
  const note = gapNote(observedDates, emptyDates, uncheckedDates);
  const arc = classifyArc(observedDates, today);
  let status: RouteStatus = "unknown";
  if (!flights.length && blockedDates.length && !emptyDates.length) status = "blocked";
  else if (note) status = "possible_gap";
  else if (arc === "near_term") status = "observed";
  else if (arc === "future_only") status = "future";
  else status = "unknown";

  const next = futureFlights[0] ?? null;
  const phrase = departuresPhrase(futureDepartureCount, futureCheckedDates);
  const weekdays = weekdayLabel(futureFlightDates, futureCheckedDates);
  const lastCheckDate = pairChecks
    .filter((check) => check.state !== "unchecked")
    .map((check) => check.date)
    .sort(compareIso)
    .at(-1) ?? null;
  const flightNumbers = [...new Set(flights.map((flight) => flight.flightNumber))].sort();

  let coverageNote = "Not checked yet.";
  if (status === "possible_gap" && note) coverageNote = note;
  else if (status === "observed") coverageNote = `${phrase} ${weekdays}`;
  else if (status === "future") {
    const first = futureFlightDates.slice().sort(compareIso)[0];
    coverageNote = `Future booking observations start ${first}. A future flight is not evidence the route operates on ${today}.`;
  } else if (status === "blocked") {
    coverageNote = `Blocked on ${formatDateList(blockedDates)}. Blocked is unknown, not an empty check.`;
  } else if (observedDates.length) {
    coverageNote = `Last observed ${observedDates[observedDates.length - 1]}. No future flight is loaded. Current operation is unknown.`;
  } else if (emptyDates.length) {
    coverageNote = `Checked empty on ${formatDateList(emptyDates)}. That is negative evidence for those dates only.`;
  }

  return {
    origin,
    destination,
    status,
    observedDates,
    firstObservedDate: observedDates[0] ?? null,
    lastObservedDate: observedDates[observedDates.length - 1] ?? null,
    futureDepartureCount,
    futureCheckedDates,
    departuresPhrase: phrase,
    weekdayLabel: weekdays,
    flightNumbers,
    nextDeparture: next
      ? {
          date: next.date,
          flightNumber: next.flightNumber,
          departureLocal: next.departureLocal,
          arrivalLocal: next.arrivalLocal,
        }
      : null,
    emptyDates,
    blockedDates,
    uncheckedDates,
    lastCheckDate,
    gapNote: note,
    coverageNote,
  };
}

export function dateVerdict(observations: Observation[], checks: Check[], origin: string, destination: string, date: string): DateVerdict {
  const flights = observations
    .filter((flight) => flight.origin === origin && flight.destination === destination && flight.date === date)
    .sort((left, right) => left.departureLocal.localeCompare(right.departureLocal));
  if (flights.length) {
    const numbers = flights.map((flight) => flight.flightNumber).join(", ");
    return {
      kind: "flight_found",
      flights,
      sentence: `Flight found on ${date} (${flights.length} departure${flights.length === 1 ? "" : "s"}: ${numbers}).`,
    };
  }
  const check = checks.find((item) => item.origin === origin && item.destination === destination && item.date === date);
  if (check?.state === "checked_empty") {
    return { kind: "checked_empty", flights: [], sentence: `Checked empty on ${date}. That is negative evidence for this date only.` };
  }
  if (check?.state === "blocked") {
    return { kind: "blocked", flights: [], sentence: `Blocked on ${date}. This date is unknown.` };
  }
  if (check?.state === "unchecked") {
    return { kind: "not_checked", flights: [], sentence: `Not checked yet for ${date}.` };
  }
  return { kind: "not_checked", flights: [], sentence: `Not checked yet for ${date}.` };
}

export type ProvenanceModel = {
  source: string;
  sourceUrl: string;
  lastRefresh: string | null;
  lastRefreshText: string;
  coverageText: string;
  stale: boolean;
};

export function provenanceModel(input: { lastRefresh?: string | null; today?: string; now?: Date }): ProvenanceModel {
  const lastRefresh = input.lastRefresh ?? null;
  let stale = false;
  let lastRefreshText = "Last successful refresh time was not recorded on these observations.";
  if (lastRefresh) {
    const parsed = Date.parse(lastRefresh);
    if (Number.isFinite(parsed)) {
      const ageHours = ((input.now ?? new Date()).getTime() - parsed) / 3_600_000;
      stale = ageHours > 36;
      lastRefreshText = stale
        ? `Last successful refresh ${lastRefresh}. That refresh looks stale.`
        : `Last successful refresh ${lastRefresh}.`;
    } else {
      lastRefreshText = `Last successful refresh ${lastRefresh}.`;
    }
  }
  return {
    source: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    lastRefresh,
    lastRefreshText,
    coverageText: "Coverage is recorded per route and date. Flight found, checked empty, blocked, and not checked yet are different. A listed market is not a nonstop.",
    stale,
  };
}

export function provenanceText(model: ProvenanceModel): string {
  return `${model.source}. ${model.lastRefreshText} ${model.coverageText}`;
}

export type HomeRow = {
  origin: string;
  destination: string;
  status: RouteStatus;
  arc: ArcKind;
  text: string;
};

export function homeRows(summaries: RouteSummary[], today: string): HomeRow[] {
  const home = new Set<string>(HOME_AIRPORTS);
  return summaries
    .filter((summary) => {
      if (!home.has(summary.origin) || !home.has(summary.destination)) return false;
      const arc = classifyArc(summary.observedDates, today);
      if (arc !== "none") return true;
      return isPriorityCorridor(summary.origin, summary.destination) || summary.gapNote !== null || summary.status === "blocked";
    })
    .map((summary) => ({
      origin: summary.origin,
      destination: summary.destination,
      status: summary.status,
      arc: classifyArc(summary.observedDates, today),
      text: summary.coverageNote,
    }))
    .sort((left, right) => {
      const rank = priorityRank(left.origin) - priorityRank(right.origin);
      if (rank !== 0) return rank;
      return priorityRank(left.destination) - priorityRank(right.destination) || left.origin.localeCompare(right.origin);
    });
}

export function watchFor(summary: RouteSummary): Watch {
  if (summary.gapNote) {
    return { origin: summary.origin, destination: summary.destination, signal: "possible_gap", text: summary.gapNote };
  }
  if (summary.status === "blocked") {
    return { origin: summary.origin, destination: summary.destination, signal: "blocked", text: summary.coverageNote };
  }
  if (summary.status === "future") {
    return { origin: summary.origin, destination: summary.destination, signal: "future", text: summary.coverageNote };
  }
  if (summary.status === "unknown" || summary.uncheckedDates.length > 0 || summary.futureCheckedDates === 0) {
    const text = summary.observedDates.length
      ? summary.coverageNote
      : summary.emptyDates.length
        ? summary.coverageNote
        : "Not checked yet.";
    return { origin: summary.origin, destination: summary.destination, signal: "coverage_problem", text };
  }
  return { origin: summary.origin, destination: summary.destination, signal: "observed", text: summary.departuresPhrase };
}

export type CalendarMark = "flight" | "empty" | "blocked" | "unchecked";

export function calendarMarks(checks: Check[], origin: string, destination: string): Record<string, CalendarMark> {
  const marks: Record<string, CalendarMark> = {};
  for (const check of checks) {
    if (check.origin !== origin || check.destination !== destination) continue;
    if (check.state === "flights_found") marks[check.date] = "flight";
    else if (check.state === "checked_empty") marks[check.date] = "empty";
    else if (check.state === "blocked") marks[check.date] = "blocked";
    else marks[check.date] = "unchecked";
  }
  return marks;
}

export function bayToSocalPairs(): Array<{ origin: string; destination: string }> {
  const pairs: Array<{ origin: string; destination: string }> = [];
  for (const origin of BAY_ORIGINS) {
    for (const destination of SOCAL_DESTINATIONS) pairs.push({ origin, destination });
  }
  return pairs;
}
