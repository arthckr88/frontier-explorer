import { DateTime } from "luxon";
import { and, eq, gt } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { getDb } from "@/server/db/client";
import { sourceCache } from "@/server/db/schema";
import { parseBookingMarkets, parsePublicScheduleHtml, type PublicFlight } from "@/server/ingestion/parse/public-schedule";
import type { SourceRunResult } from "@/server/ingestion/types";
import { PRIORITY_AIRPORTS } from "@/server/preferences/defaults";
import type { Observation } from "@/types/domain";

const SOURCE_ID = "frontier-public-schedule";
const ORIGIN = "https://booking.flyfrontier.com";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export type PublicScheduleOptions = {
  now?: Date;
  onObservation?: (observation: Observation) => Promise<void>;
};

type DayResult =
  | { ok: true; flights: PublicFlight[] }
  | { ok: false; error: string; retryable?: boolean };

export async function fetchPublicSchedule(options: PublicScheduleOptions = {}): Promise<SourceRunResult> {
  const started = Date.now();
  const env = getEnv();
  const days = clamp(env.PUBLIC_SCHEDULE_DAYS, 7, 14);
  const concurrency = clamp(env.PUBLIC_SCHEDULE_CONCURRENCY, 1, 2);
  const now = options.now ?? new Date();
  const dates = rollingDates(now, days);
  const homepage = await requestText(`${ORIGIN}/`, new CookieJar(), "follow", `${ORIGIN}/`);
  if (!homepage.ok) {
    return {
      sourceId: SOURCE_ID,
      status: "failure",
      observations: [],
      error: `Booking homepage ${homepage.status || "failed"}: ${homepage.error ?? "no body"}`,
      detail:
        "The public booking page https://booking.flyfrontier.com/ did not load, so no schedule was invented. Flight times are read only from the HTML of /Flight/Select after the public search form's GET.",
      latencyMs: Date.now() - started,
      recordsObserved: 0,
    };
  }
  const markets = parseBookingMarkets(homepage.body);
  const pairs = priorityPairs(markets);
  if (pairs.length === 0) {
    return {
      sourceId: SOURCE_ID,
      status: "failure",
      observations: [],
      error: "The booking homepage HTML had no station market list.",
      detail:
        "https://booking.flyfrontier.com/ returned HTML, but the public search config did not include a stations[].markets list. No flights were invented.",
      latencyMs: Date.now() - started,
      recordsObserved: 0,
    };
  }

  const observations: Observation[] = [];
  const emptyPairs: string[] = [];
  let failedDates = 0;
  let flightCount = 0;
  let cursor = 0;

  async function worker() {
    let session = await openSession();
    while (cursor < pairs.length) {
      const index = cursor;
      cursor += 1;
      const pair = pairs[index];
      if (!pair) return;
      const outcome = await pullPair(session, pair.origin, pair.destination, dates);
      session = outcome.session;
      failedDates += outcome.failedDates;
      if (outcome.flights.length === 0) {
        if (outcome.checkedDates.length > 0) emptyPairs.push(`${pair.origin}-${pair.destination}`);
        continue;
      }
      const observation = snapshot(pair.origin, pair.destination, outcome, dates, new Date());
      observations.push(observation);
      flightCount += outcome.flights.length;
      if (options.onObservation) await options.onObservation(observation);
      if ((index + 1) % 10 === 0 || outcome.flights.length > 0) {
        console.error(
          `public schedule ${index + 1}/${pairs.length} ${pair.origin}-${pair.destination} flights=${outcome.flights.length} totalRoutes=${observations.length} totalFlights=${flightCount} failedDates=${failedDates}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, () => worker()));

  const stored = new Set(observations.map((item) => `${item.origin}-${item.destination}`));
  const priorityGaps = priorityRouteGaps(markets, stored);
  const status = failedDates > 0 && flightCount === 0 ? "failure" : failedDates > 0 ? "partial" : "success";
  return {
    sourceId: SOURCE_ID,
    status,
    observations: options.onObservation ? [] : observations,
    error: failedDates > 0 ? `${failedDates} booking result pages failed and were not treated as empty days.` : undefined,
    detail: [
      `Public booking results at ${ORIGIN}/Flight/Select after GET ${ORIGIN}/Flight/InternalSelect.`,
      `Priority origins ${PRIORITY_AIRPORTS.join(", ")} to published markets.`,
      `Window ${dates[0]} through ${dates[dates.length - 1]} (${dates.length} dates).`,
      `Stored ${observations.length} directional routes and ${flightCount} dated flights.`,
      `${emptyPairs.length} market pairs returned no nonstop F9 flight in the checked days.`,
      priorityGaps.length > 0
        ? `Priority routes with no schedule observation: ${priorityGaps.join(", ")}.`
        : "Every priority-to-priority market in this pull had at least one nonstop.",
      "Connections and non-F9 legs were not stored. Flights-from fare blurbs were not used.",
    ]
      .filter(Boolean)
      .join(" "),
    latencyMs: Date.now() - started,
    recordsObserved: flightCount,
  };
}

function priorityPairs(markets: Map<string, string[]>) {
  const priority = new Set<string>(PRIORITY_AIRPORTS);
  const pairs: { origin: string; destination: string }[] = [];
  for (const origin of PRIORITY_AIRPORTS) {
    const destinations = markets.get(origin) ?? [];
    const ordered = [
      ...destinations.filter((destination) => priority.has(destination)),
      ...destinations.filter((destination) => !priority.has(destination)),
    ];
    for (const destination of ordered) {
      if (destination !== origin) pairs.push({ origin, destination });
    }
  }
  return pairs;
}

function priorityRouteGaps(markets: Map<string, string[]>, stored: Set<string>) {
  const gaps: string[] = [];
  for (const origin of PRIORITY_AIRPORTS) {
    for (const destination of PRIORITY_AIRPORTS) {
      if (origin === destination) continue;
      if (stored.has(`${origin}-${destination}`)) continue;
      const listed = (markets.get(origin) ?? []).includes(destination);
      gaps.push(listed ? `${origin}-${destination}` : `${origin}-${destination} (not listed as a market)`);
    }
  }
  return gaps;
}

function snapshot(
  origin: string,
  destination: string,
  outcome: { flights: PublicFlight[]; checkedDates: string[] },
  dates: string[],
  now: Date,
): Observation {
  const checked = [...outcome.checkedDates].sort();
  const complete = checked.length === dates.length;
  return {
    id: `${origin}-${destination}`,
    sourceId: SOURCE_ID,
    sourceName: "Frontier public booking search",
    sourceTier: 1,
    sourceKind: "frontier_schedule",
    url: `${ORIGIN}/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${dates[0]}&ADT=1&umnr=false&mon=true`,
    retrievedAt: now.toISOString(),
    externalId: "public-select",
    origin,
    destination,
    kind: "schedule_snapshot",
    successful: true,
    windowStart: checked[0] ?? dates[0],
    windowEnd: checked[checked.length - 1] ?? dates[0],
    frequencyPerWeek: complete ? outcome.flights.length : null,
    flights: outcome.flights.map((flight) => ({
      date: flight.date,
      departureLocal: flight.departureLocal,
      arrivalLocal: flight.arrivalLocal,
      flightNumber: flight.flightNumber,
    })),
  };
}

async function pullPair(session: CookieJar | null, origin: string, destination: string, dates: string[]) {
  const flights: PublicFlight[] = [];
  const checkedDates: string[] = [];
  let failedDates = 0;
  for (const date of dates) {
    const cached = await readCache(origin, destination, date);
    if (cached) {
      flights.push(...cached);
      checkedDates.push(date);
      continue;
    }
    let loaded: DayResult = { ok: false, error: "Booking session was not opened." };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!session) session = await openSession();
      if (!session) {
        loaded = { ok: false, error: "Booking homepage did not open a session." };
        await pause(30_000);
        continue;
      }
      loaded = await loadDay(session, origin, destination, date);
      if (loaded.ok) break;
      console.error(`public schedule fail ${origin}-${destination} ${date} ${loaded.error}`);
      if (!loaded.retryable) break;
      session = null;
      const blocked = loaded.error.includes("406");
      await pause(blocked ? 45_000 : 8_000);
    }
    if (!loaded.ok) {
      failedDates += 1;
      continue;
    }
    const matched = loaded.flights.filter((flight) => flight.origin === origin && flight.destination === destination);
    await writeCache(origin, destination, date, matched);
    flights.push(...matched);
    checkedDates.push(date);
  }
  return { flights, checkedDates, failedDates, session };
}

async function openSession() {
  const jar = new CookieJar();
  const home = await requestText(`${ORIGIN}/`, jar, "follow", `${ORIGIN}/`);
  if (!home.ok) {
    console.error(`public schedule homepage HTTP ${home.status}: ${home.error ?? ""}`.trim());
    return null;
  }
  return jar;
}

async function loadDay(jar: CookieJar, origin: string, destination: string, date: string): Promise<DayResult> {
  const searchUrl = `${ORIGIN}/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${date}&ADT=1&umnr=false&mon=true`;
  const search = await requestText(searchUrl, jar, "manual", `${ORIGIN}/`);
  if (search.status === 406) return { ok: false, error: "InternalSelect HTTP 406", retryable: true };
  if (!search.ok && search.status !== 301 && search.status !== 302 && search.status !== 303) {
    return { ok: false, error: `InternalSelect HTTP ${search.status}: ${search.error ?? ""}`.trim(), retryable: search.status >= 500 };
  }
  const html = search.body.includes("FlightData = '")
    ? search
    : await requestText(`${ORIGIN}/Flight/Select`, jar, "manual", searchUrl);
  if (html.status === 406) return { ok: false, error: "Select HTTP 406", retryable: true };
  if (!html.ok) {
    return {
      ok: false,
      error: `Select HTTP ${html.status}: ${html.error ?? ""}`.trim(),
      retryable: html.status >= 500 || html.status === 0,
    };
  }
  const parsed = parsePublicScheduleHtml(html.body);
  if (!parsed.ok) return { ok: false, error: parsed.reason, retryable: true };
  if (parsed.query.origin !== origin || parsed.query.destination !== destination || parsed.query.date !== date) {
    return {
      ok: false,
      error: `Results page was ${parsed.query.origin}-${parsed.query.destination} on ${parsed.query.date}`,
      retryable: true,
    };
  }
  return { ok: true, flights: parsed.flights };
}

class CookieJar {
  private values = new Map<string, string>();

  absorb(headers: Headers) {
    const lines = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of lines) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      this.values.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

let nextSlot = Promise.resolve();

function throttle(ms: number) {
  const run = nextSlot.then(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  nextSlot = run.catch(() => undefined);
  return run;
}

const BROWSER_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

async function requestText(url: string, jar: CookieJar, redirect: "manual" | "follow", referer: string) {
  const attempts = 2;
  const delayMs = clamp(getEnv().PUBLIC_SCHEDULE_DELAY_MS, 250, 5_000);
  let lastError = "Request failed";
  let status = 0;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    await throttle(attempt === 0 ? delayMs : Math.min(8_000, delayMs * 2 ** attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const cookie = jar.header();
      const response = await fetch(url, {
        method: "GET",
        redirect,
        signal: controller.signal,
        headers: {
          ...BROWSER_HEADERS,
          referer,
          ...(cookie ? { cookie } : {}),
        },
      });
      jar.absorb(response.headers);
      status = response.status;
      const body = await response.text();
      const redirectOk = redirect === "manual" && status >= 300 && status < 400;
      if (response.ok || redirectOk) return { ok: response.ok, status, body, error: undefined as string | undefined };
      lastError = `HTTP ${status}`;
      if (status === 406 || (status !== 429 && status < 500)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Network error";
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status, body: "", error: lastError };
}

function pause(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function cacheKey(origin: string, destination: string, date: string) {
  return `${origin}|${destination}|${date}`;
}

async function readCache(origin: string, destination: string, date: string): Promise<PublicFlight[] | null> {
  const database = getDb();
  if (!database) return null;
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  const [row] = await database
    .select()
    .from(sourceCache)
    .where(
      and(
        eq(sourceCache.sourceId, SOURCE_ID),
        eq(sourceCache.cacheKey, cacheKey(origin, destination, date)),
        gt(sourceCache.fetchedAt, cutoff),
      ),
    )
    .limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.body) as { flights?: PublicFlight[] };
    return parsed.flights ?? [];
  } catch {
    return null;
  }
}

async function writeCache(origin: string, destination: string, date: string, flights: PublicFlight[]) {
  const database = getDb();
  if (!database) return;
  await database
    .insert(sourceCache)
    .values({
      sourceId: SOURCE_ID,
      cacheKey: cacheKey(origin, destination, date),
      fetchedAt: new Date(),
      body: JSON.stringify({ flights }),
    })
    .onConflictDoUpdate({
      target: [sourceCache.sourceId, sourceCache.cacheKey],
      set: { fetchedAt: new Date(), body: JSON.stringify({ flights }) },
    });
}

function rollingDates(now: Date, days: number) {
  const start = DateTime.fromJSDate(now, { zone: "America/Denver" }).startOf("day");
  return Array.from({ length: days }, (_, index) => start.plus({ days: index }).toISODate()).filter(
    (date): date is string => Boolean(date),
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
