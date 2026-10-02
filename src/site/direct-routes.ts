export const OFFICIAL_SOURCE = "Frontier official direct routes";
export const SITEMAP_FROM_CITY = "https://flights.flyfrontier.com/en/sitemap/flights-from-city/page-1";
export const SITEMAP_CITY_TO_CITY = "https://flights.flyfrontier.com/en/sitemap/city-to-city-flights/page-1";
export const SITEMAP_XML = "https://flights.flyfrontier.com/en/sitemap.xml";
export const FLIGHTS_ORIGIN = "https://flights.flyfrontier.com";
/**
 * Integrity fails above this count.
 * The count is city pages that do not designate one IATA airport.
 * Popularity links and city-to-city markets are not unresolved mappings and are not routes.
 */
export const UNRESOLVED_MAPPING_THRESHOLD = 40;

export type OfficialAirport = {
  iata: string;
  city: string;
  name: string | null;
  country: string | null;
};

export type OfficialRoute = {
  origin: string;
  destination: string;
  originCity: string;
  destinationCity: string;
  sourceUrl: string;
  provenance: "frontier_official_direct_route";
  nonstopEvidence?: { kind: "explicit_nonstop"; sourceUrl: string; retrievedAt: string };
};

export type UnresolvedMapping = {
  originSlug: string;
  destinationSlug: string;
  originCity: string | null;
  destinationLabel: string;
  reason: string;
};

export type FareModuleSample = {
  origin: string;
  embedded: number;
  total: number;
  lastPage: number;
  sourceUrl: string;
  named?: number;
  status?: "complete" | "blocked";
  detail?: string;
};

export type FareModuleRead = {
  origin: string;
  status: "complete" | "blocked";
  destinations: string[];
  currentPage: number | null;
  lastPage: number | null;
  total: number | null;
  detail: string;
};

export type ScheduleDiscrepancy = {
  origin: string;
  destination: string;
  classification: "SCHEDULE_CONFIRMED_ONLY" | "IMPORTER_MISSED_ROUTE";
  reason: string;
};

export type OfficialCatalogue = {
  retrievedAt: string;
  source: typeof OFFICIAL_SOURCE;
  sourceUrl: string;
  airports: OfficialAirport[];
  routes: OfficialRoute[];
  unresolved: UnresolvedMapping[];
  fareModules: FareModuleSample[];
};

export type CandidateMarket = {
  originSlug: string;
  destinationSlug: string;
  origin: string | null;
  destination: string | null;
  originCity: string | null;
  destinationCity: string | null;
  sourceUrl: string;
  provenance: "frontier_candidate_market";
};

export type ParsedFarePair = {
  origin: string;
  destination: string;
  originCity: string | null;
  destinationCity: string | null;
  explicitNonstop?: boolean;
};

export function hasNonstopEvidence(route: OfficialRoute): boolean {
  const evidence = route.nonstopEvidence;
  if (evidence?.kind !== "explicit_nonstop" || !Number.isFinite(Date.parse(evidence.retrievedAt))) return false;
  try {
    const url = new URL(evidence.sourceUrl);
    return url.protocol === "https:" && (url.hostname === "flyfrontier.com" || url.hostname.endsWith(".flyfrontier.com"));
  } catch { return false; }
}

export type ParsedFlightsFromPage = {
  slug: string;
  sourceUrl: string;
  originCode: string | null;
  originCity: string | null;
  originAirports: string[];
  farePairs: ParsedFarePair[];
  fareModule: { embedded: number; total: number; lastPage: number } | null;
};

export function absoluteFlightsUrl(href: string) {
  if (href.startsWith("http")) return href.split("?")[0] ?? href;
  const path = href.startsWith("/") ? href : `/${href}`;
  return `${FLIGHTS_ORIGIN}${path.split("?")[0]}`;
}

export function parseSitemapLinks(html: string, pattern: RegExp) {
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((match) => match[1] ?? "");
  const links = new Set<string>();
  for (const href of hrefs) {
    if (!pattern.test(href)) continue;
    links.add(absoluteFlightsUrl(href));
  }
  return [...links].sort();
}

export function parseFlightsFromSitemap(html: string) {
  return parseSitemapLinks(html, /\/flights-from-[a-z0-9-]+\/?$/i).filter((url) => !url.includes("-to-"));
}

export function parseCityToCitySitemap(html: string) {
  const located = [...html.matchAll(/<loc>\s*([^<\s]*flights-from-[a-z0-9-]+-to-[a-z0-9-]+)\/?\s*<\/loc>/gi)].map((match) => absoluteFlightsUrl(match[1] ?? ""));
  const linked = parseSitemapLinks(html, /\/flights-from-[a-z0-9-]+-to-[a-z0-9-]+\/?$/i);
  return [...new Set([...located, ...linked])].sort().map((sourceUrl) => {
    const slug = sourceUrl.split("/").pop() ?? "";
    const match = /^flights-from-(.+)-to-(.+)$/.exec(slug);
    return {
      originSlug: match?.[1] ?? "",
      destinationSlug: match?.[2] ?? "",
      sourceUrl,
    };
  });
}

export function parseFlightsFromPage(html: string, sourceUrl: string): ParsedFlightsFromPage {
  const slug = sourceUrl.split("/").pop()?.replace(/\/$/, "") ?? "";
  const citySlug = slug.replace(/^flights-from-/, "");
  const data = readNextData(html);
  const context = parseOriginContext(html);
  const originCode = firstString(data, "user_input_origin_airport_code");
  const originCity = firstString(data, "OriginCityName") || context.city;
  const listed = [...stringArrays(data, "originAirports").flat(), ...context.originAirports];
  const originAirports = [...new Set(listed.filter((code) => /^[A-Z]{3}$/.test(code)))];
  return {
    slug: citySlug,
    sourceUrl,
    originCode: /^[A-Z]{3}$/.test(originCode) ? originCode : null,
    originCity: originCity || null,
    originAirports,
    farePairs: farePairs(data),
    fareModule: fareModuleSample(data),
  };
}

export function parseOriginContext(html: string) {
  const city = /OriginCityName\\":\\"([^\\"]+)/.exec(html)?.[1] ?? /"OriginCityName":"([^"]+)"/.exec(html)?.[1] ?? null;
  const raw = /originAirports\\":\[([^\]]*)\]/.exec(html)?.[1] ?? /"originAirports":\[([^\]]*)\]/.exec(html)?.[1] ?? "";
  const originAirports = [...raw.matchAll(/[A-Z]{3}/g)].map((match) => match[0]);
  return { city, originAirports: [...new Set(originAirports)] };
}

export function designatedAirport(page: ParsedFlightsFromPage) {
  if (page.originCode && (page.originAirports.length === 0 || page.originAirports.includes(page.originCode))) return page.originCode;
  if (!page.originCode && page.originAirports.length === 1) return page.originAirports[0] ?? null;
  return null;
}

export function composeOfficialCatalogue(
  pages: ParsedFlightsFromPage[],
  retrievedAt: string,
  reference: Map<string, { name: string; city: string; country: string }> = new Map(),
): OfficialCatalogue {
  const routes: OfficialRoute[] = [];
  const unresolved: UnresolvedMapping[] = [];
  const fareModules: FareModuleSample[] = [];
  const seen = new Set<string>();
  const pageCities = new Map<string, string>();
  for (const page of pages) {
    const origin = designatedAirport(page);
    if (!origin) {
      unresolved.push({
        originSlug: page.slug,
        destinationSlug: "",
        originCity: page.originCity,
        destinationLabel: page.slug,
        reason: page.originAirports.length > 1
          ? "City page listed more than one airport and did not designate one."
          : "City page did not name one airport.",
      });
      continue;
    }
    pageCities.set(origin, cityName(page.originCity, origin, reference));
    if (page.fareModule) {
      fareModules.push({ origin, ...page.fareModule, sourceUrl: page.sourceUrl });
    }
    for (const pair of page.farePairs) {
      // A marketed fare pair can include connections. Missing layovers is not proof.
      if (!pair.explicitNonstop) continue;
      const known = reference.size === 0 || (reference.has(pair.origin) && reference.has(pair.destination));
      if (!known) {
        unresolved.push({
          originSlug: page.slug,
          destinationSlug: pair.destination.toLowerCase(),
          originCity: page.originCity,
          destinationLabel: `${pair.origin}-${pair.destination}`,
          reason: "Fare named an airport code that is not in the airport reference.",
        });
        continue;
      }
      const key = `${pair.origin}|${pair.destination}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({
        origin: pair.origin,
        destination: pair.destination,
        originCity: cityName(pair.originCity, pair.origin, reference) || cityName(page.originCity, pair.origin, reference),
        destinationCity: cityName(pair.destinationCity, pair.destination, reference),
        sourceUrl: page.sourceUrl,
        provenance: "frontier_official_direct_route",
        nonstopEvidence: { kind: "explicit_nonstop", sourceUrl: page.sourceUrl, retrievedAt },
      });
    }
  }
  routes.sort((left, right) => left.origin.localeCompare(right.origin) || left.destination.localeCompare(right.destination));
  const airportCodes = new Set<string>(pageCities.keys());
  for (const route of routes) {
    airportCodes.add(route.origin);
    airportCodes.add(route.destination);
  }
  const airports = [...airportCodes]
    .sort()
    .map((iata) => {
      const known = reference.get(iata);
      const page = pages.find((item) => designatedAirport(item) === iata);
      return {
        iata,
        city: known?.city || page?.originCity || iata,
        name: known?.name ?? null,
        country: known?.country ?? null,
      };
    });
  unresolved.sort((left, right) => left.originSlug.localeCompare(right.originSlug) || left.destinationSlug.localeCompare(right.destinationSlug));
  return {
    retrievedAt,
    source: OFFICIAL_SOURCE,
    sourceUrl: SITEMAP_FROM_CITY,
    airports,
    routes,
    unresolved,
    fareModules: fareModules.sort((left, right) => left.origin.localeCompare(right.origin)),
  };
}

export function classifyScheduleGap(
  origin: string,
  destination: string,
  module: FareModuleSample | { embedded: number; total: number; status?: FareModuleSample["status"]; named?: number; lastPage?: number; detail?: string } | null,
): ScheduleDiscrepancy {
  if (module?.status === "blocked") {
    return {
      origin,
      destination,
      classification: "SCHEDULE_CONFIRMED_ONLY",
      reason: `BLOCKED. The ${origin} flights-from page did not show the remaining fare rows${module.detail ? `: ${module.detail}` : "."} ${destination} is not named on the rows that loaded. Not guessed.`,
    };
  }
  if (module && (module.status === "complete" || (module.total > 0 && module.embedded >= module.total))) {
    const named = module.named ?? module.embedded;
    const pages = module.lastPage ?? 1;
    return {
      origin,
      destination,
      classification: "SCHEDULE_CONFIRMED_ONLY",
      reason: `Dated browser nonstop. The ${origin} flights-from fare module was read in full (${named} named destinations, ${pages} page${pages === 1 ? "" : "s"}) and does not name ${destination}. Not taken from a candidate market.`,
    };
  }
  if (module && module.total > module.embedded) {
    return {
      origin,
      destination,
      classification: "IMPORTER_MISSED_ROUTE",
      reason: `Dated browser nonstop. ${destination} is not in the ${module.embedded} fare rows embedded for ${origin}. The module reports ${module.total} fare rows and the remaining page was not read.`,
    };
  }
  return {
    origin,
    destination,
    classification: "SCHEDULE_CONFIRMED_ONLY",
    reason: `Dated browser nonstop. No flights-from fare module for ${origin} names ${destination}. Not taken from a candidate market.`,
  };
}

export function applyFareModuleReads(
  catalogue: OfficialCatalogue,
  reads: FareModuleRead[],
  _reference: Map<string, { name: string; city: string; country: string }> = new Map(),
): OfficialCatalogue {
  const readByOrigin = new Map(reads.map((read) => [read.origin, read]));
  void _reference; // Retained for existing importer callers; market names are not promoted.
  const routes = [...catalogue.routes];
  const airports = [...catalogue.airports];
  const unresolved = [...catalogue.unresolved];
  // Fare-module destination names do not identify the number of stops.
  // Keep pagination metadata, but never promote those markets to direct arcs.
  routes.sort((left, right) => left.origin.localeCompare(right.origin) || left.destination.localeCompare(right.destination));
  airports.sort((left, right) => left.iata.localeCompare(right.iata));
  const fareModules = catalogue.fareModules.map((sample) => {
    const read = readByOrigin.get(sample.origin);
    const named = routes.filter((route) => route.origin === sample.origin).length;
    if (!read) {
      const complete = sample.total === 0 || (sample.total > 0 && sample.embedded >= sample.total);
      return {
        ...sample,
        named,
        status: complete ? "complete" as const : undefined,
        detail: sample.total === 0 ? "The flights-from page reported no fare rows." : complete ? "The static flights-from page already includes every reported fare row." : sample.detail,
      };
    }
    return {
      ...sample,
      total: read.total ?? sample.total,
      lastPage: read.lastPage ?? sample.lastPage,
      named,
      status: read.status,
      detail: read.detail,
    };
  });
  return { ...catalogue, airports, routes, unresolved, fareModules };
}

export function composeCandidateMarkets(pairs: { originSlug: string; destinationSlug: string; sourceUrl: string }[], pages: ParsedFlightsFromPage[], official: OfficialCatalogue): CandidateMarket[] {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const directs = new Set(official.routes.map((route) => `${route.origin}|${route.destination}`));
  const markets: CandidateMarket[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const originPage = bySlug.get(pair.originSlug);
    const destinationPage = bySlug.get(pair.destinationSlug);
    const origin = originPage ? designatedAirport(originPage) : null;
    const destination = destinationPage ? designatedAirport(destinationPage) : null;
    if (origin && destination && directs.has(`${origin}|${destination}`)) continue;
    const key = `${pair.originSlug}|${pair.destinationSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    markets.push({
      originSlug: pair.originSlug,
      destinationSlug: pair.destinationSlug,
      origin,
      destination,
      originCity: originPage?.originCity ?? null,
      destinationCity: destinationPage?.originCity ?? null,
      sourceUrl: pair.sourceUrl,
      provenance: "frontier_candidate_market",
    });
  }
  return markets.sort((left, right) => left.originSlug.localeCompare(right.originSlug) || left.destinationSlug.localeCompare(right.destinationSlug));
}

export function catalogueDiff(previous: OfficialCatalogue | null, next: OfficialCatalogue) {
  const before = new Set((previous?.routes ?? []).map((route) => `${route.origin}-${route.destination}`));
  const after = new Set(next.routes.map((route) => `${route.origin}-${route.destination}`));
  const added = [...after].filter((key) => !before.has(key)).sort();
  const removed = [...before].filter((key) => !after.has(key)).sort();
  return {
    previousRoutes: before.size,
    routes: after.size,
    airports: next.airports.length,
    unresolved: next.unresolved.length,
    added,
    removed,
  };
}

function cityName(label: string | null, iata: string | null, reference: Map<string, { name: string; city: string; country: string }>) {
  if (iata && reference.get(iata)?.city) return reference.get(iata)?.city ?? "";
  if (!label) return iata ?? "";
  return label.split(",")[0]?.trim() || label;
}

function readNextData(html: string): unknown {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return null;
  }
}

function firstString(value: unknown, key: string): string {
  let found = "";
  walk(value, (node) => {
    if (found || !node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    if (typeof record[key] === "string" && record[key]) found = record[key];
  });
  return found;
}

function stringArrays(value: unknown, key: string): string[][] {
  const found: string[][] = [];
  walk(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record[key]) && record[key].length > 0 && record[key].every((item) => typeof item === "string")) found.push(record[key] as string[]);
  });
  return found;
}

function fareModuleSample(value: unknown): { embedded: number; total: number; lastPage: number } | null {
  let found: { embedded: number; total: number; lastPage: number } | null = null;
  walk(value, (node) => {
    if (found || !node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    const pagination = record.pagination;
    if (!pagination || typeof pagination !== "object" || Array.isArray(pagination)) return;
    const page = pagination as Record<string, unknown>;
    if (typeof page.total !== "number" || typeof page.lastPage !== "number") return;
    const embedded = Array.isArray(record.fares) ? record.fares.length : typeof page.to === "number" ? page.to : 0;
    found = { embedded, total: page.total, lastPage: page.lastPage };
  });
  return found;
}

function farePairs(value: unknown): ParsedFarePair[] {
  const pairs: ParsedFarePair[] = [];
  const seen = new Set<string>();
  walk(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    const origin = record.originAirportCode;
    const destination = record.destinationAirportCode;
    if (typeof origin !== "string" || typeof destination !== "string") return;
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) return;
    if (Array.isArray(record.layovers) && record.layovers.length > 0) return;
    const key = `${origin}|${destination}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({
      origin,
      destination,
      originCity: typeof record.originCity === "string" ? record.originCity : null,
      destinationCity: typeof record.destinationCity === "string" ? record.destinationCity : null,
      explicitNonstop: record.nonstop === true || record.stops === 0,
    });
  });
  return pairs;
}

function walk(value: unknown, visit: (node: unknown) => void) {
  const seen = new Set<unknown>();
  const queue = [value];
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    visit(current);
    if (Array.isArray(current)) queue.push(...current);
    else queue.push(...Object.values(current as Record<string, unknown>));
  }
}
