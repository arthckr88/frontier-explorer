export type ParsedRule = {
  program: "gowild" | "discount_den";
  ruleKey: string;
  summary: string;
  value: Record<string, string | number | boolean | null>;
  sourceUrl?: string;
};

function collapse(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function windowAround(text: string, pattern: RegExp, radius = 220): string | null {
  const match = pattern.exec(text);
  if (!match || match.index == null) return null;
  const start = Math.max(0, match.index - 40);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end).trim();
}

const DATED_DAY = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b/i;

export function parseProgramText(text: string, program: ParsedRule["program"]): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const flat = collapse(text);
  const domestic = windowAround(flat, /domestic[\s\S]{0,160}?day before|day before[\s\S]{0,160}?domestic/i);
  if (domestic && program === "gowild") {
    rules.push({
      program,
      ruleKey: "domestic_booking_window",
      summary: domestic,
      value: { leadDays: 1 },
    });
  }
  const international = windowAround(flat, /international[\s\S]{0,120}?10 days|10 days[\s\S]{0,120}?international/i);
  if (international && program === "gowild") {
    rules.push({
      program,
      ruleKey: "international_booking_window",
      summary: international,
      value: { leadDays: 10 },
    });
  }
  const baseFare = windowAround(flat, /\$0\.01/);
  if (baseFare && program === "gowild") {
    rules.push({
      program,
      ruleKey: "base_fare",
      summary: baseFare,
      value: { baseFareCents: 1 },
    });
  }
  const blackout = windowAround(flat, /blackout(?:\s+dates?)?(?:[\s\S]{0,90})/i, 0);
  if (blackout && DATED_DAY.test(blackout) && !/as posted/i.test(blackout)) {
    rules.push({
      program,
      ruleKey: "blackout",
      summary: blackout,
      value: { listed: true },
    });
  }
  const stacking = windowAround(
    flat,
    /discount den[\s\S]{0,160}gowild[\s\S]{0,80}(?:not|cannot|can't|separate)|gowild[\s\S]{0,160}discount den[\s\S]{0,80}(?:not|cannot|can't|separate)/i,
  );
  if (stacking) {
    rules.push({
      program,
      ruleKey: "do_not_stack",
      summary: stacking,
      value: { stackable: false },
    });
  }
  return rules;
}
