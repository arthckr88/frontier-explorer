import { fetchText } from "@/server/ingestion/http";
import { extractFeedItems, parseNewsroomFeed } from "@/server/ingestion/parse/newsroom";
import type { SourceRunResult } from "@/server/ingestion/types";

const FEEDS = [
  "https://news.flyfrontier.com/tagfeed/en-us/tags/news,national",
  "https://news.flyfrontier.com/tagfeed/en-us/tags/news,city",
];

export async function fetchNewsroom(): Promise<SourceRunResult> {
  const started = Date.now();
  const observations = [];
  const announcements = [];
  const errors: string[] = [];
  let okCount = 0;
  for (const url of FEEDS) {
    const response = await fetchText(url, { minDelayMs: 400 });
    if (!response.ok) {
      errors.push(`${url}: ${response.error ?? response.status}`);
      continue;
    }
    okCount += 1;
    const retrievedAt = new Date().toISOString();
    observations.push(...parseNewsroomFeed(response.body, retrievedAt));
    for (const item of extractFeedItems(response.body)) {
      announcements.push({
        origin: null,
        destination: null,
        title: item.title,
        url: item.link || null,
        summary: item.title,
        kind: "headline",
        announcedStart: null,
        announcedEnd: null,
        externalId: item.externalId,
        publishedAt: Number.isNaN(Date.parse(item.pubDate)) ? null : new Date(item.pubDate).toISOString(),
      });
    }
  }
  const status = okCount === 0 ? "failure" : errors.length ? "partial" : "success";
  return {
    sourceId: "frontier-newsroom",
    status,
    observations,
    announcements,
    error: errors.join(" | ") || undefined,
    detail: `Fetched ${okCount}/${FEEDS.length} official newsroom feeds.`,
    latencyMs: Date.now() - started,
    recordsObserved: observations.length,
  };
}
