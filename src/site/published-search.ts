export type PublishedFlight = {
  origin: string;
  destination: string;
  flightNumber: string;
  date: string;
  departureLocal: string;
  arrivalLocal: string;
  departureUtc: string;
  arrivalUtc: string;
};

export type PublishedSchedule = {
  flights: PublishedFlight[];
  checked: string[];
  blocked: string[];
};

export type PublishedItinerary = {
  stops: number;
  elapsedMinutes: number;
  vegasOvernight: boolean;
  connectionLabel: string | null;
  segments: PublishedFlight[];
};

const MIN_CONNECTION = 60;
const NORMAL_MAX = 4 * 60;
const LONG_MAX = 8 * 60;
const STOPOVER_MAX = 24 * 60;

export function searchPublished(
  flights: PublishedFlight[],
  query: { from: string; to: string; date: string },
): PublishedItinerary[] {
  const from = query.from.trim().toUpperCase();
  const to = query.to.trim().toUpperCase();
  const date = query.date;
  const results: PublishedItinerary[] = [];
  const seen = new Set<string>();

  const add = (segments: PublishedFlight[], vegasOvernight: boolean, connectionLabel: string | null) => {
    if (segments.some(isRedEye)) return;
    const key = segments.map((segment) => `${segment.flightNumber}|${segment.departureUtc}|${segment.origin}|${segment.destination}`).join(">");
    if (seen.has(key)) return;
    seen.add(key);
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) return;
    results.push({
      stops: segments.length - 1,
      elapsedMinutes: minutesBetween(first.departureUtc, last.arrivalUtc),
      vegasOvernight,
      connectionLabel,
      segments,
    });
  };

  for (const flight of flights) {
    if (flight.origin === from && flight.destination === to && flight.date === date) add([flight], false, null);
  }

  const nextDate = addDays(date, 1);
  const firstLegs = flights.filter((flight) => flight.origin === from && flight.date === date && flight.destination !== to);
  for (const first of firstLegs) {
    const secondLegs = flights.filter((flight) => {
      if (flight.origin !== first.destination || flight.destination !== to) return false;
      if (flight.date === date) return true;
      return first.destination === "LAS" && nextDate !== null && flight.date === nextDate;
    });
    for (const second of secondLegs) {
      const connection = connect(first, second);
      if (!connection) continue;
      add([first, second], connection.vegasOvernight, connection.label);
    }
  }

  results.sort((left, right) => {
    if (left.stops !== right.stops) return left.stops - right.stops;
    const depart = left.segments[0]?.departureUtc.localeCompare(right.segments[0]?.departureUtc ?? "") ?? 0;
    if (depart !== 0) return depart;
    return left.elapsedMinutes - right.elapsedMinutes;
  });
  return results;
}

function connect(first: PublishedFlight, second: PublishedFlight): { vegasOvernight: boolean; label: string } | null {
  const gap = minutesBetween(first.arrivalUtc, second.departureUtc);
  if (!Number.isFinite(gap) || gap < MIN_CONNECTION || gap > STOPOVER_MAX) return null;
  const overnightGround = gap >= LONG_MAX && second.departureLocal.slice(0, 10) > first.arrivalLocal.slice(0, 10);
  const vegasOvernight = first.destination === "LAS" && overnightGround;
  if (gap <= NORMAL_MAX) return { vegasOvernight: false, label: `${Math.round(gap)} min in ${first.destination}` };
  if (gap <= LONG_MAX) return { vegasOvernight: false, label: `${Math.round(gap)} min in ${first.destination}` };
  if (!overnightGround) return null;
  return {
    vegasOvernight,
    label: vegasOvernight ? "Overnight in Las Vegas" : `Overnight ground stop in ${first.destination}`,
  };
}

function isRedEye(flight: PublishedFlight): boolean {
  const departureMinutes = clockMinutes(flight.departureLocal);
  if (departureMinutes === null) return false;
  if (departureMinutes >= 22 * 60 || departureMinutes < 5 * 60) return true;
  const airborneHours = minutesBetween(flight.departureUtc, flight.arrivalUtc) / 60;
  const arrivalMinutes = clockMinutes(flight.arrivalLocal);
  const arrivesNextDay = flight.arrivalLocal.slice(0, 10) > flight.departureLocal.slice(0, 10);
  return airborneHours >= 3 && arrivesNextDay && arrivalMinutes !== null && arrivalMinutes < 8 * 60 && departureMinutes >= 17 * 60;
}

function minutesBetween(startUtc: string, endUtc: string): number {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;
  return (end - start) / 60_000;
}

function clockMinutes(local: string): number | null {
  const match = /T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function addDays(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
