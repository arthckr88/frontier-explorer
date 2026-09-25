const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export function decodeHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&bull;/g, " · ");
}

export function stripTags(html: string): string {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLooseDate(text: string, articleDate: string): string | null {
  const cleaned = text.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  const monthFirst = cleaned.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(\d{4})?/i,
  );
  const dayFirst = cleaned.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,)?\s*(\d{4})?/i,
  );
  const match = monthFirst
    ? { month: monthFirst[1], day: Number(monthFirst[2]), year: monthFirst[3] }
    : dayFirst
      ? { month: dayFirst[2], day: Number(dayFirst[1]), year: dayFirst[3] }
      : null;
  if (!match?.month || !match.day) return null;
  const month = MONTHS[match.month.slice(0, 3).toLowerCase()];
  if (!month || match.day < 1 || match.day > 31) return null;
  const article = new Date(`${articleDate.slice(0, 10)}T00:00:00.000Z`);
  let year = match.year ? Number(match.year) : article.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, match.day));
  if (!match.year && candidate.getTime() < article.getTime() - 60 * 86_400_000) {
    year += 1;
  }
  const iso = new Date(Date.UTC(year, month - 1, match.day)).toISOString().slice(0, 10);
  return iso;
}

export function parseFrequency(text: string): {
  perWeek: number | null;
  raw: string;
  footnote: boolean;
} {
  const raw = text.trim();
  const weekly = raw.match(/(\d+)\s*x\s*\/\s*week/i) ?? raw.match(/(\d+)\s*times?\s+(?:per|a)\s+week/i);
  if (weekly?.[1]) return { perWeek: Number(weekly[1]), raw, footnote: false };
  if (/^daily\b/i.test(raw)) return { perWeek: 7, raw, footnote: /^daily\s+\d/i.test(raw) };
  return { perWeek: null, raw, footnote: false };
}

export function articleDateFromPubDate(pubDate: string): string {
  const parsed = new Date(pubDate);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}
