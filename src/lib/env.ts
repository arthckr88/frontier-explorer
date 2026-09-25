import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

let loaded = false;

export function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!key || process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  ADMIN_SECRET: z.string().optional(),
  TILE_STYLE_URL: z.string().default("https://tiles.openfreemap.org/styles/dark"),
  TIMETABLE_API_URL: z.string().optional(),
  TIMETABLE_API_KEY: z.string().optional(),
  BTS_INTERNATIONAL_RESOURCE_URL: z
    .string()
    .default("https://data.transportation.gov/resource/xgub-n9bw.json"),
  BTS_DOMESTIC_RESOURCE_URL: z.string().optional(),
  AIRPORT_PRESS_URLS: z.string().optional(),
  SYNC_PRIORITY_HOURS: z.coerce.number().default(2),
  SYNC_SCHEDULE_HOURS: z.coerce.number().default(6),
  SYNC_ANNOUNCEMENTS_HOURS: z.coerce.number().default(2),
  SYNC_PROGRAMS_HOURS: z.coerce.number().default(24),
  SYNC_RECONCILE_HOURS: z.coerce.number().default(24),
  SYNC_POPULARITY_DAYS: z.coerce.number().default(30),
  PUBLIC_SCHEDULE_DAYS: z.coerce.number().default(7),
  PUBLIC_SCHEDULE_CONCURRENCY: z.coerce.number().default(1),
  PUBLIC_SCHEDULE_DELAY_MS: z.coerce.number().default(1200),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  loadEnvFile();
  return envSchema.parse(process.env);
}

export const DEFAULT_TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";
