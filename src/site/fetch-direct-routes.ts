import { readFileSync, writeFileSync } from "node:fs";
import {
  SITEMAP_CITY_TO_CITY,
  SITEMAP_FROM_CITY,
  SITEMAP_XML,
  catalogueDiff,
  applyFareModuleReads,
  composeCandidateMarkets,
  composeOfficialCatalogue,
  parseCityToCitySitemap,
  parseFlightsFromPage,
  parseFlightsFromSitemap,
  type OfficialCatalogue,
} from "@/site/direct-routes";
import { readTruncatedFareModules } from "@/site/read-fare-pages";

const cataloguePath = new URL("../../data/frontier-direct-routes.json", import.meta.url);
const marketsPath = new URL("../../data/frontier-markets.json", import.meta.url);
const airportsPath = new URL("../../data/airports.json", import.meta.url);

void main();

async function main() {
const retrievedAt = new Date().toISOString();
const fromSitemap = await fetchText(SITEMAP_FROM_CITY);
const citySitemap = await fetchText(SITEMAP_CITY_TO_CITY);
const xmlSitemap = await fetchText(SITEMAP_XML);
const pageUrls = uniquePages(parseFlightsFromSitemap(fromSitemap), parseFlightsFromSitemap(citySitemap));
if (pageUrls.length === 0) {
  console.error("The flights-from sitemap did not list any city pages.");
  process.exit(1);
}
const pages = await mapPool(pageUrls, 6, async (url) => {
  const html = await fetchText(url);
  return parseFlightsFromPage(html, url);
});
const reference = airportReference();
const drafted = composeOfficialCatalogue(pages, retrievedAt, reference);
const catalogue = applyFareModuleReads(drafted, await readTruncatedFareModules(drafted), reference);
const markets = composeCandidateMarkets(parseCityToCitySitemap(`${citySitemap}\n${xmlSitemap}`), pages, catalogue);
const previous = readPrevious();
const diff = catalogueDiff(previous, catalogue);
const denModule = catalogue.fareModules.find((sample) => sample.origin === "DEN");
const denDestinations = catalogue.routes.filter((route) => route.origin === "DEN").length;
writeFileSync(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
writeFileSync(
  marketsPath,
  `${JSON.stringify({ retrievedAt, source: "Frontier city-to-city sitemap", provenance: "frontier_candidate_market", markets }, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      source: catalogue.source,
      retrievedAt,
      airports: diff.airports,
      directedRoutes: diff.routes,
      unresolved: diff.unresolved,
      candidateMarkets: markets.length,
      added: diff.added.length,
      removed: diff.removed.length,
      addedSample: diff.added.slice(0, 12),
      removedSample: diff.removed.slice(0, 12),
      denDestinations,
      denFareModule: denModule ?? null,
    },
    null,
    2,
  ),
);
if (catalogue.routes.length === 0) process.exit(1);
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { "user-agent": "FrontierRouteExplorer/1.0 (public catalogue import)" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

function uniquePages(left: string[], right: string[]) {
  return [...new Set([...left, ...right])].sort();
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function airportReference() {
  const rows = JSON.parse(readFileSync(airportsPath, "utf8")) as { iata: string; name: string; city: string; country: string }[];
  return new Map(rows.map((row) => [row.iata, { name: row.name, city: row.city, country: row.country }]));
}

function readPrevious(): OfficialCatalogue | null {
  try {
    return JSON.parse(readFileSync(cataloguePath, "utf8")) as OfficialCatalogue;
  } catch {
    return null;
  }
}
