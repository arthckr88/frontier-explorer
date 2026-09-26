import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

export function secretMatches(provided: string | null | undefined, expected: string | undefined) {
  if (!expected || !provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function cronAuthorized(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return secretMatches(token, env.CRON_SECRET);
}

export function adminAuthorized(request: Request) {
  const env = getEnv();
  if (!env.ADMIN_SECRET) return false;
  return secretMatches(request.headers.get("x-admin-secret"), env.ADMIN_SECRET);
}
