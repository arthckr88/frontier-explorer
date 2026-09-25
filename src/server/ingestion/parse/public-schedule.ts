export type PublicFlight = {
  origin: string;
  destination: string;
  flightNumber: string;
  date: string;
  departureLocal: string;
  arrivalLocal: string;
};

export type ScheduleParseResult =
  | { ok: true; flights: PublicFlight[] }
  | { ok: false; reason: string };

type Leg = {
  departureStation?: string;
  arrivalStation?: string;
  departureDate?: string;
  arrivalDate?: string;
  flightNumber?: number | string;
  carrierCode?: string;
};

type Itinerary = {
  stopCount?: number;
  legs?: Leg[];
};

type FlightData = {
  journeys?: { flights?: Itinerary[] }[];
};

export function parsePublicScheduleHtml(html: string): ScheduleParseResult {
  const marker = "FlightData = '";
  const start = html.indexOf(marker);
  if (start < 0) {
    return { ok: false, reason: "FlightData assignment was not in the booking results HTML." };
  }
  const from = start + marker.length;
  const end = html.indexOf("';", from);
  if (end < 0) {
    return { ok: false, reason: "FlightData assignment did not end in the booking results HTML." };
  }
  const decoded = html
    .slice(from, end)
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
  let data: FlightData;
  try {
    data = JSON.parse(decoded) as FlightData;
  } catch {
    return { ok: false, reason: "FlightData JSON in the booking results HTML did not parse." };
  }

  const flights: PublicFlight[] = [];
  for (const journey of data.journeys ?? []) {
    for (const itinerary of journey.flights ?? []) {
      const legs = itinerary.legs ?? [];
      if (legs.length !== 1 || (itinerary.stopCount != null && itinerary.stopCount > 0)) continue;
      const leg = legs[0];
      const flight = nonstopLeg(leg);
      if (flight) flights.push(flight);
    }
  }
  return { ok: true, flights };
}

function nonstopLeg(leg: Leg | undefined): PublicFlight | null {
  if (!leg) return null;
  const origin = leg.departureStation?.toUpperCase();
  const destination = leg.arrivalStation?.toUpperCase();
  const carrier = (leg.carrierCode ?? "").toUpperCase();
  const departureLocal = localTimestamp(leg.departureDate);
  const arrivalLocal = localTimestamp(leg.arrivalDate);
  const flightNumber = leg.flightNumber == null ? "" : String(leg.flightNumber);
  if (!origin || !destination || !departureLocal || !arrivalLocal || !flightNumber) return null;
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
  if (carrier !== "F9") return null;
  return {
    origin,
    destination,
    flightNumber,
    date: departureLocal.slice(0, 10),
    departureLocal,
    arrivalLocal,
  };
}

function localTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3] ?? "00"}`;
}

export function parseBookingMarkets(html: string): Map<string, string[]> {
  const decoded = html.includes('"stations":') ? html : html.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const key = decoded.indexOf('"stations":');
  if (key < 0) return new Map();
  const start = decoded.indexOf("[", key);
  if (start < 0) return new Map();
  const end = matchingBracket(decoded, start);
  if (end < 0) return new Map();
  let groups: { stations?: { code?: string; markets?: string[] }[] }[];
  try {
    groups = JSON.parse(decoded.slice(start, end)) as typeof groups;
  } catch {
    return new Map();
  }
  const markets = new Map<string, string[]>();
  for (const group of groups) {
    for (const station of group.stations ?? []) {
      const code = station.code?.toUpperCase();
      if (!code || !/^[A-Z]{3}$/.test(code)) continue;
      const destinations = [...new Set((station.markets ?? []).map((item) => item.toUpperCase()))].filter((item) =>
        /^[A-Z]{3}$/.test(item),
      );
      markets.set(code, destinations.sort());
    }
  }
  return markets;
}

function matchingBracket(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}
