import type { Observation } from "@/types/domain";
import type { ParsedRule } from "@/server/ingestion/parse/programs";

export type SourceRunResult = {
  sourceId: string;
  status: "success" | "failure" | "skipped" | "partial";
  observations: Observation[];
  rules?: ParsedRule[];
  replacedRuleSourceUrls?: string[];
  metrics?: {
    origin: string;
    destination: string;
    value: number;
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    domesticComparable: boolean;
  }[];
  announcements?: {
    origin: string | null;
    destination: string | null;
    title: string;
    url: string | null;
    summary: string;
    kind: string;
    announcedStart: string | null;
    announcedEnd: string | null;
    externalId: string;
    publishedAt: string | null;
  }[];
  error?: string;
  detail?: string;
  latencyMs: number;
  recordsObserved: number;
};
