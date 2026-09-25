"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { userPreferences } from "@/server/db/schema";
import { defaultPreferences } from "@/server/preferences/defaults";
import type { FareMode, UserPreferences } from "@/types/domain";

export async function savePreferences(formData: FormData) {
  const database = getDb();
  const fareMode = formData.get("fareMode");
  const mode: FareMode = fareMode === "gowild" || fareMode === "discount_den" ? fareMode : "standard";
  const next: UserPreferences = {
    ...defaultPreferences,
    fareMode: mode,
    excludeRedEyes: formData.get("excludeRedEyes") === "on",
    allowIntentionalStopover: formData.get("allowIntentionalStopover") === "on",
    preferVegasStopover: formData.get("preferVegasStopover") === "on",
    allowMultiDay: formData.get("allowMultiDay") === "on",
    includeNearby: formData.get("includeNearby") === "on",
    maxStops: clamp(Number(formData.get("maxStops")), 0, 2, defaultPreferences.maxStops),
    minConnectionMinutes: clamp(Number(formData.get("minConnectionMinutes")), 45, 240, defaultPreferences.minConnectionMinutes),
  };
  if (database) {
    await database
      .insert(userPreferences)
      .values({ id: "default", payload: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userPreferences.id,
        set: { payload: next, updatedAt: new Date() },
      });
  }
  redirect("/settings");
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

void eq;
