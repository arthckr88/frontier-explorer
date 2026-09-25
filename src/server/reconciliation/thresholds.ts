export type Thresholds = {
  endingSoonDays: number;
  possiblyEndingGapDays: number;
  sparseLookaheadDays: number;
  sparseWeeklyMax: number;
  seasonalGapDays: number;
  staleVerificationHours: number;
  disagreementDays: number;
  horizonSlackDays: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  endingSoonDays: 21,
  possiblyEndingGapDays: 21,
  sparseLookaheadDays: 21,
  sparseWeeklyMax: 3,
  seasonalGapDays: 60,
  staleVerificationHours: 48,
  disagreementDays: 1,
  horizonSlackDays: 7,
};

export function resolveThresholds(partial?: Partial<Thresholds>): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...partial };
}

export function thresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): Thresholds {
  const num = (name: string, fallback: number) => {
    const raw = env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  return resolveThresholds({
    endingSoonDays: num("ENDING_SOON_DAYS", DEFAULT_THRESHOLDS.endingSoonDays),
    possiblyEndingGapDays: num(
      "POSSIBLY_ENDING_GAP_DAYS",
      DEFAULT_THRESHOLDS.possiblyEndingGapDays,
    ),
    sparseLookaheadDays: num("SPARSE_LOOKAHEAD_DAYS", DEFAULT_THRESHOLDS.sparseLookaheadDays),
    seasonalGapDays: num("SEASONAL_GAP_DAYS", DEFAULT_THRESHOLDS.seasonalGapDays),
    staleVerificationHours: num(
      "STALE_VERIFICATION_HOURS",
      DEFAULT_THRESHOLDS.staleVerificationHours,
    ),
  });
}
