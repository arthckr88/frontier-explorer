import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hoursBetween(earlierIso: string, laterIso: string): number {
  return (Date.parse(laterIso) - Date.parse(earlierIso)) / 3_600_000;
}

export function todayFromIso(iso: string): string {
  return iso.slice(0, 10);
}

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

export function daysBetween(earlier: string, later: string): number {
  const ms = parseISODate(later).getTime() - parseISODate(earlier).getTime();
  return Math.round(ms / 86_400_000);
}

export function addDays(isoDate: string, days: number): string {
  const date = parseISODate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isoWeekday(isoDate: string): number {
  const sundayZero = parseISODate(isoDate).getUTCDay();
  return sundayZero === 0 ? 7 : sundayZero;
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function latestBy<T>(
  items: T[],
  keyFn: (item: T) => string,
  timeFn: (item: T) => string,
): T[] {
  const chosen = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item);
    const previous = chosen.get(key);
    if (!previous || timeFn(item) > timeFn(previous)) chosen.set(key, item);
  }
  return [...chosen.values()];
}
