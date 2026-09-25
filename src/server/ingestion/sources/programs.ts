import { fetchText } from "@/server/ingestion/http";
import { parseProgramText } from "@/server/ingestion/parse/programs";
import { stripTags } from "@/server/ingestion/parse/text";
import type { SourceRunResult } from "@/server/ingestion/types";

const PAGES = [
  { url: "https://www.flyfrontier.com/deals/gowild-pass", program: "gowild" as const },
  { url: "https://faq.flyfrontier.com/help/how-do-i-book-a-gowild-flight", program: "gowild" as const },
  { url: "https://www.flyfrontier.com/deals/discount-den", program: "discount_den" as const },
];

export async function fetchPrograms(): Promise<SourceRunResult> {
  const started = Date.now();
  const rules = [];
  const replacedRuleSourceUrls: string[] = [];
  const errors: string[] = [];
  let ok = 0;
  for (const page of PAGES) {
    const response = await fetchText(page.url);
    if (!response.ok) {
      errors.push(`${page.url}: ${response.error ?? response.status}`);
      continue;
    }
    ok += 1;
    replacedRuleSourceUrls.push(page.url);
    rules.push(...parseProgramText(stripTags(response.body), page.program).map((rule) => ({
      ...rule,
      sourceUrl: page.url,
    })));
  }
  return {
    sourceId: "frontier-programs",
    status: ok === 0 ? "failure" : errors.length ? "partial" : "success",
    observations: [],
    rules,
    replacedRuleSourceUrls,
    error: errors.join(" | ") || undefined,
    detail:
      rules.length === 0
        ? "Pages were fetched but no booking-window sentences were recognized. Rules were not invented."
        : `Stored ${rules.length} sentences found on official pages.`,
    latencyMs: Date.now() - started,
    recordsObserved: rules.length,
  };
}
