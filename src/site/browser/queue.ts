import { MAX_QUEUE, SEARCH_PAUSE_MS, type BrowserQuery, type BrowserResult } from "@/site/browser/types";

export async function runBrowserQueue(
  queries: BrowserQuery[],
  search: (query: BrowserQuery) => Promise<BrowserResult>,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pauseMs = SEARCH_PAUSE_MS,
): Promise<BrowserResult[]> {
  if (queries.length > MAX_QUEUE) {
    throw new Error(`The local queue accepts at most ${MAX_QUEUE} searches.`);
  }
  const results: BrowserResult[] = [];
  for (const [index, query] of queries.entries()) {
    if (index > 0) await pause(pauseMs);
    const result = await search(query);
    results.push(result);
    if (result.status === "blocked") break;
  }
  return results;
}
