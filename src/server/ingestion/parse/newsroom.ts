import { createHash } from "node:crypto";
import { articleDateFromPubDate, parseFrequency, parseLooseDate, stripTags } from "@/server/ingestion/parse/text";
import type { AnnouncementKind, Observation } from "@/types/domain";

export type FeedItem = {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  externalId: string;
};

function tagValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() ?? "";
}

export function extractFeedItems(xml: string): FeedItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return items.map((item, index) => {
    const block = item[1] ?? "";
    const link = stripTags(tagValue(block, "link") || tagValue(block, "guid"));
    const caseId = tagValue(block, "pp:caseid");
    return {
      title: stripTags(tagValue(block, "title")),
      link,
      pubDate: stripTags(tagValue(block, "pubDate")),
      description: tagValue(block, "description"),
      externalId: caseId || link || `item-${index}`,
    };
  });
}

function announcementKind(title: string, text: string): AnnouncementKind {
  const blob = `${title} ${text}`;
  if (/discontinu|cease service|final flight|last day of service|will end service/i.test(blob)) return "end";
  if (/seasonal/i.test(blob)) return "seasonal";
  if (/\breturn(?:s|ed|ing)?\b/i.test(title)) return "return";
  if (/frequency/i.test(blob) && !/new service|nonstop|route/i.test(blob)) return "frequency";
  if (/nonstop|new service|new route|launch/i.test(blob)) return "launch";
  return "other";
}

function pushRoute(
  results: Observation[],
  item: FeedItem,
  retrievedAt: string,
  origin: string,
  destination: string,
  fields: {
    announcedStart?: string | null;
    announcedEnd?: string | null;
    frequencyPerWeek?: number | null;
    frequencyText?: string | null;
  },
) {
  if (origin === destination) return;
  const kind = announcementKind(item.title, stripTags(item.description));
  const articleDate = articleDateFromPubDate(item.pubDate);
  results.push({
    id: `${item.externalId}-${origin}-${destination}`,
    sourceId: "frontier-newsroom",
    sourceName: "Frontier Newsroom",
    sourceTier: 1,
    sourceKind: "announcement",
    url: item.link,
    retrievedAt,
    externalId: item.externalId,
    origin,
    destination,
    kind: "announcement",
    announcementKind: kind,
    seasonal: kind === "seasonal",
    announcedStart: fields.announcedStart ?? (kind === "launch" ? articleDate : null),
    announcedEnd: fields.announcedEnd ?? null,
    announcedFrequencyPerWeek: fields.frequencyPerWeek ?? null,
    frequencyText: fields.frequencyText ?? null,
    title: item.title,
  });
}

export function parseNewsroomFeed(xml: string, retrievedAt: string): Observation[] {
  const results: Observation[] = [];
  for (const item of extractFeedItems(xml)) {
    const articleDate = articleDateFromPubDate(item.pubDate);
    const html = item.description;
    const parts = html.split(/New service from/i);
    let tableRoutes = 0;
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      const origin = part.match(/\(([A-Z]{3})\)/)?.[1];
      const table = part.match(/<table[\s\S]*?<\/table>/i)?.[0];
      if (!origin || !table) continue;
      const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
      for (const row of rows) {
        const cells = [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
          stripTags(cell[1] ?? ""),
        );
        if (cells.length < 3 || /service to/i.test(cells[0] ?? "")) continue;
        const destination = cells[0]?.match(/\(([A-Z]{3})\)/)?.[1];
        if (!destination) continue;
        const frequency = parseFrequency(cells[2] ?? "");
        pushRoute(results, item, retrievedAt, origin, destination, {
          announcedStart: parseLooseDate(cells[1] ?? "", articleDate),
          frequencyPerWeek: frequency.perWeek,
          frequencyText: frequency.footnote ? `${frequency.raw} (footnote in source)` : frequency.raw,
        });
        tableRoutes += 1;
      }
    }
    if (tableRoutes > 0) continue;
    const text = stripTags(html);
    const prose = [
      ...text.matchAll(/from\s+[^()]{0,90}\(([A-Z]{3})\)\s+to\s+[^()]{0,90}\(([A-Z]{3})\)/gi),
    ];
    for (const match of prose) {
      const origin = match[1];
      const destination = match[2];
      if (!origin || !destination) continue;
      const kind = announcementKind(item.title, text);
      pushRoute(results, item, retrievedAt, origin, destination, {
        announcedStart: kind === "launch" ? articleDate : null,
        announcedEnd: kind === "end" ? parseLooseDate(text, articleDate) : null,
      });
    }
  }
  return results;
}

export function observationHash(observation: Observation): string {
  const stable = JSON.stringify(observation, (key, value) =>
    key === "id" || key === "retrievedAt" ? undefined : value,
  );
  return createHash("sha256").update(stable).digest("hex");
}
