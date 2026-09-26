import { parseLooseDate, stripTags } from "@/server/ingestion/parse/text";
import type { Observation } from "@/types/domain";

export function parseMarketedSamples(
  html: string,
  pageUrl: string,
  retrievedAt: string,
): Observation[] {
  const text = stripTags(html);
  const matches = [
    ...text.matchAll(
      /\(([A-Z]{3})\)\s+[^(]{0,50}?\(([A-Z]{3})\)\s+[^(]{0,90}?Departing\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})(?:\s+From\s+(\$[\d,]+))?/g,
    ),
  ];
  return matches.flatMap((match) => {
    const origin = match[1];
    const destination = match[2];
    const date = parseLooseDate(match[3] ?? "", retrievedAt);
    if (!origin || !destination || !date) return [];
    return [
      {
        id: `marketed-${origin}-${destination}-${date}`,
        sourceId: "frontier-route-pages",
        sourceName: "Frontier flights-from pages",
        sourceTier: 1 as const,
        sourceKind: "frontier_route_page" as const,
        url: pageUrl,
        retrievedAt,
        externalId: pageUrl,
        origin,
        destination,
        kind: "marketed_sample" as const,
        marketedDate: date,
        marketedFareText: match[4] ?? null,
        title: "Marketed sample on a Frontier flights-from page. Not a timetable.",
      },
    ];
  });
}

export function matchFlightFromLinks(
  html: string,
  airports: { iata: string; city: string }[],
): { iata: string; url: string }[] {
  const hrefs = [...html.matchAll(/href="([^"]*flights-from-[^"]+)"/gi)].map((match) => match[1] ?? "");
  const found: { iata: string; url: string }[] = [];
  for (const airport of airports) {
    const slug = airport.city
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug) continue;
    const href = hrefs.find((value) => value.toLowerCase().includes(`/flights-from-${slug}`));
    if (!href) continue;
    const url = href.startsWith("http") ? href : `https://flights.flyfrontier.com${href}`;
    found.push({ iata: airport.iata, url });
  }
  return found;
}
