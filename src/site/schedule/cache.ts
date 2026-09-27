import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ScheduleQuery } from "@/site/schedule/budget";

export type CacheRecord = {
  key: string;
  fetchedAt: string;
  numPages: number;
  body: unknown;
};

export type QueryCache = {
  get(key: string, now: Date): CacheRecord | null;
  set(record: CacheRecord): void;
};

export function queryCacheKey(query: ScheduleQuery): string {
  return JSON.stringify({
    provider: query.provider,
    endpoint: query.endpoint,
    airline: query.airline,
    origin: query.origin ?? "",
    destination: query.destination ?? "",
    dateStart: query.dateStart ?? "",
    dateEnd: query.dateEnd ?? "",
    maxPages: query.maxPages,
    includeCodeshares: false,
    includeRegional: false,
  });
}

export function cacheTtlMs(query: ScheduleQuery, today: string): number {
  if (query.endpoint === "operator") return 365 * 24 * 60 * 60 * 1000;
  const end = query.dateEnd ?? today;
  const start = query.dateStart ?? today;
  const horizon = daySpan(today, end);
  const lead = daySpan(today, start);
  if (horizon <= 14) return 24 * 60 * 60 * 1000;
  if (lead <= 60) return 7 * 24 * 60 * 60 * 1000;
  if (horizon <= 180) return 30 * 24 * 60 * 60 * 1000;
  return 365 * 24 * 60 * 60 * 1000;
}

export function memoryCache(ttlFor: (key: string) => number = () => 24 * 60 * 60 * 1000): QueryCache {
  const rows = new Map<string, CacheRecord>();
  return {
    get(key, now) {
      const row = rows.get(key);
      if (!row) return null;
      if (now.getTime() - Date.parse(row.fetchedAt) > ttlFor(key)) return null;
      return row;
    },
    set(record) {
      rows.set(record.key, record);
    },
  };
}

export function fileCache(path: string, ttlFor: (key: string) => number): QueryCache {
  const rows = readRows(path);
  return {
    get(key, now) {
      const row = rows.get(key);
      if (!row) return null;
      if (now.getTime() - Date.parse(row.fetchedAt) > ttlFor(key)) return null;
      return row;
    },
    set(record) {
      rows.set(record.key, record);
      mkdirSync(dirname(path), { recursive: true });
      const body = JSON.stringify([...rows.values()], null, 2);
      writeFileSync(path, `${body}\n`);
    },
  };
}

function readRows(path: string): Map<string, CacheRecord> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheRecord[];
    return new Map(parsed.map((row) => [row.key, row]));
  } catch {
    return new Map();
  }
}

function daySpan(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}
