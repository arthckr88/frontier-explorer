import { daysBetween, hoursBetween, isoWeekday, latestBy, todayFromIso, uniqueSorted } from "@/lib/utils";
import type {
  Confidence,
  Disagreement,
  Observation,
  RouteProjection,
  RouteStatus,
  SourceEvidence,
} from "@/types/domain";
import { resolveThresholds, type Thresholds } from "@/server/reconciliation/thresholds";

const SCHEDULE_STATUSES: RouteStatus[] = [
  "ACTIVE",
  "UPCOMING",
  "ENDING_SOON",
  "SEASONAL",
  "POSSIBLY_ENDING",
  "STALE",
];

function routeKey(origin: string, destination: string) {
  return `${origin}-${destination}`;
}

function maxDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((best, date) => (date > best ? date : best));
}

function minDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((best, date) => (date < best ? date : best));
}

function currentObservations(observations: Observation[]): Observation[] {
  const relevant = observations.filter(
    (observation) =>
      observation.kind === "schedule_snapshot" ||
      observation.kind === "announcement" ||
      observation.kind === "marketed_sample",
  );
  return latestBy(
    relevant,
    (observation) =>
      `${observation.kind}|${observation.sourceId}|${observation.externalId}|${observation.origin}|${observation.destination}`,
    (observation) => observation.retrievedAt,
  );
}

function evidence(observation: Observation): SourceEvidence {
  return {
    sourceId: observation.sourceId,
    sourceName: observation.sourceName,
    sourceTier: observation.sourceTier,
    sourceKind: observation.sourceKind,
    url: observation.url,
    retrievedAt: observation.retrievedAt,
    kind: observation.kind,
  };
}

export function deriveRoute(input: {
  origin: string;
  destination: string;
  now: string;
  observations: Observation[];
  previous?: RouteProjection | null;
  thresholds?: Partial<Thresholds>;
}): RouteProjection {
  const thresholds = resolveThresholds(input.thresholds);
  const today = todayFromIso(input.now);
  const origin = input.origin.toUpperCase();
  const destination = input.destination.toUpperCase();
  const current = currentObservations(
    input.observations.filter(
      (observation) =>
        observation.origin.toUpperCase() === origin &&
        observation.destination.toUpperCase() === destination,
    ),
  );
  const schedules = current.filter(
    (observation) => observation.kind === "schedule_snapshot" && observation.successful !== false,
  );
  const announcements = current.filter((observation) => observation.kind === "announcement");
  const marketed = current.filter((observation) => observation.kind === "marketed_sample");
  const previous = input.previous ?? null;

  const flightDates = uniqueSorted(
    schedules.flatMap((snapshot) => (snapshot.flights ?? []).map((flight) => flight.date)),
  );
  const futureDates = flightDates.filter((date) => date >= today);
  const pastDates = flightDates.filter((date) => date < today);
  const lastFlight = maxDate(flightDates);
  const firstFlight = minDate(flightDates);
  const latestScheduleAt = maxDate(schedules.map((snapshot) => snapshot.retrievedAt));
  const scheduleFresh =
    latestScheduleAt != null &&
    hoursBetween(latestScheduleAt, input.now) <= thresholds.staleVerificationHours;

  const announcedStarts = announcements
    .map((announcement) => announcement.announcedStart)
    .filter((date): date is string => Boolean(date));
  const announcedEnds = announcements
    .map((announcement) => announcement.announcedEnd)
    .filter((date): date is string => Boolean(date));
  const announcedStart = minDate(announcedStarts);
  const uniqueEnds = uniqueSorted(announcedEnds);
  const announcedEnd = uniqueEnds.length === 1 ? uniqueEnds[0] : null;
  const seasonal = announcements.some(
    (announcement) => announcement.seasonal || announcement.announcementKind === "seasonal",
  );
  const latestAnnouncementWithFrequency = [...announcements]
    .reverse()
    .find((announcement) => announcement.announcedFrequencyPerWeek != null);
  const announcedFrequency = latestAnnouncementWithFrequency?.announcedFrequencyPerWeek ?? null;

  const sourceLastFlights = schedules
    .map((snapshot) => ({
      sourceId: snapshot.sourceId,
      sourceName: snapshot.sourceName,
      last: maxDate((snapshot.flights ?? []).map((flight) => flight.date)),
    }))
    .filter((item): item is { sourceId: string; sourceName: string; last: string } => Boolean(item.last));

  const disagreements: Disagreement[] = [];
  if (sourceLastFlights.length >= 2) {
    const earliest = sourceLastFlights.reduce((best, item) => (item.last < best.last ? item : best));
    const latest = sourceLastFlights.reduce((best, item) => (item.last > best.last ? item : best));
    if (daysBetween(earliest.last, latest.last) > thresholds.disagreementDays) {
      disagreements.push({
        field: "lastScheduledDeparture",
        values: sourceLastFlights.map((item) => ({
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          value: item.last,
        })),
      });
    }
  }
  if (uniqueEnds.length > 1) {
    disagreements.push({
      field: "announcedEndDate",
      values: announcements
        .filter((announcement) => announcement.announcedEnd)
        .map((announcement) => ({
          sourceId: announcement.sourceId,
          sourceName: announcement.sourceName,
          value: announcement.announcedEnd as string,
        })),
    });
  }
  if (announcedEnd && lastFlight && daysBetween(
    announcedEnd < lastFlight ? announcedEnd : lastFlight,
    announcedEnd > lastFlight ? announcedEnd : lastFlight,
  ) > thresholds.disagreementDays) {
    disagreements.push({
      field: "endDate",
      values: [
        ...schedules.map((snapshot) => ({
          sourceId: snapshot.sourceId,
          sourceName: snapshot.sourceName,
          value: maxDate((snapshot.flights ?? []).map((flight) => flight.date)) ?? "none",
        })),
        ...announcements
          .filter((announcement) => announcement.announcedEnd)
          .map((announcement) => ({
            sourceId: announcement.sourceId,
            sourceName: announcement.sourceName,
            value: announcement.announcedEnd as string,
          })),
      ],
    });
  }

  const conflicting = disagreements.length > 0;
  const hasFrontierSchedule = schedules.some(
    (snapshot) => snapshot.sourceKind === "frontier_schedule",
  );
  const hasTimetable = schedules.some((snapshot) => snapshot.sourceKind === "timetable_api");
  const hasOfficialAnnouncement = announcements.some((announcement) => announcement.sourceTier <= 2);
  const endAgrees =
    Boolean(announcedEnd && lastFlight) &&
    daysBetween(
      (announcedEnd as string) < (lastFlight as string) ? (announcedEnd as string) : (lastFlight as string),
      (announcedEnd as string) > (lastFlight as string) ? (announcedEnd as string) : (lastFlight as string),
    ) <= thresholds.disagreementDays;

  let confidence: Confidence = "UNKNOWN";
  if (conflicting) confidence = "CONFLICTING";
  else if (hasFrontierSchedule && hasOfficialAnnouncement && (endAgrees || !announcedEnd)) {
    confidence = "HIGH";
  } else if (hasFrontierSchedule) confidence = "MEDIUM";
  else if (hasTimetable) confidence = "LOW";

  const windowEnd = maxDate(
    schedules.map((snapshot) => snapshot.windowEnd).filter((date): date is string => Boolean(date)),
  );
  const lookedPastLastFlight =
    Boolean(lastFlight && windowEnd) &&
    daysBetween(lastFlight as string, windowEnd as string) > thresholds.horizonSlackDays;
  const explicitFrequency = schedules.find((snapshot) => snapshot.frequencyPerWeek != null)
    ?.frequencyPerWeek;
  const requiredGap =
    explicitFrequency != null && explicitFrequency <= thresholds.sparseWeeklyMax
      ? Math.max(thresholds.possiblyEndingGapDays, thresholds.sparseLookaheadDays)
      : thresholds.possiblyEndingGapDays;
  const windowCoversGap = windowEnd != null && daysBetween(today, windowEnd) >= requiredGap;
  const hadService =
    pastDates.length > 0 ||
    (previous != null && SCHEDULE_STATUSES.includes(previous.status)) ||
    previous?.status === "ACTIVE";

  const nextWeekEnd = new Date(Date.parse(`${today}T00:00:00.000Z`) + 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const departuresNextWeek = futureDates.filter((date) => date <= nextWeekEnd).length;
  const currentFrequency =
    schedules.length === 0
      ? null
      : (explicitFrequency ?? (futureDates.length > 0 ? departuresNextWeek : 0));
  const scheduleDays = uniqueSorted(
    flightDates.map((date) => String(isoWeekday(date))),
  ).map(Number);

  let status: RouteStatus = "UNKNOWN";
  let endConfirmed = false;
  let launchUnverified = false;
  const reasons: string[] = [];

  const freshEmpty = schedules.length > 0 && scheduleFresh && futureDates.length === 0;
  const confirmedEnd =
    !conflicting && endAgrees && announcedEnd != null && lastFlight != null && scheduleFresh;

  if (!scheduleFresh && schedules.length > 0 && (hadService || flightDates.length > 0)) {
    status = "STALE";
    reasons.push(
      "The latest schedule snapshot is older than the stale threshold, so this route was not rechecked.",
    );
  } else if (conflicting && futureDates.length > 0) {
    status = "ACTIVE";
    reasons.push("Schedule sources disagree. Future flights still appear in at least one source.");
  } else if (conflicting && freshEmpty) {
    status = "POSSIBLY_ENDING";
    reasons.push("Sources disagree and the fresh check did not show a future flight. This is not a confirmed end.");
  } else if (seasonal && futureDates.length === 0 && !confirmedEnd) {
    status = "SEASONAL";
    reasons.push("The route is marked seasonal and the current gap is not treated as a permanent end.");
  } else if (confirmedEnd && (lastFlight as string) < today) {
    status = "ENDED";
    endConfirmed = true;
    reasons.push("An official end date and the schedule snapshot agree, and that date has passed.");
  } else if (
    confirmedEnd &&
    (lastFlight as string) >= today &&
    daysBetween(today, lastFlight as string) <= thresholds.endingSoonDays
  ) {
    status = "ENDING_SOON";
    endConfirmed = true;
    reasons.push("An official end date and the schedule snapshot agree, and the final flight is soon.");
  } else if (schedules.length === 0 && announcedStart && announcedStart > today) {
    status = "ANNOUNCED";
    reasons.push("An announcement gives a future start. No schedule snapshot has validated it yet.");
  } else if (schedules.length === 0 && announcedStart && announcedStart <= today) {
    status = "UNKNOWN";
    launchUnverified = true;
    reasons.push(
      "The announced launch date has passed and no schedule observation confirms that service is operating.",
    );
  } else if (freshEmpty && windowCoversGap && (hadService || flightDates.length > 0)) {
    status = "POSSIBLY_ENDING";
    reasons.push(
      "A fresh schedule check covering the lookahead window found no future flights. The route is not marked ended.",
    );
  } else if (
    futureDates.length > 0 &&
    announcedStart &&
    today < announcedStart &&
    futureDates.every((date) => date >= announcedStart)
  ) {
    status = "UPCOMING";
    reasons.push("Flights are loaded, and the announced start date is still in the future.");
  } else if (futureDates.length > 0) {
    status = "ACTIVE";
    reasons.push("A fresh schedule snapshot includes a future flight.");
    if (
      !conflicting &&
      lastFlight &&
      lookedPastLastFlight &&
      daysBetween(today, lastFlight) <= thresholds.endingSoonDays &&
      previous?.lastScheduledDeparture &&
      previous.lastScheduledDeparture > lastFlight &&
      daysBetween(lastFlight, previous.lastScheduledDeparture) > thresholds.disagreementDays
    ) {
      status = "ENDING_SOON";
      endConfirmed = false;
      reasons.push(
        "A later flight disappeared from the newest snapshot, and the check looked past the new last date. The end is not confirmed.",
      );
    }
  } else if (marketed.length > 0) {
    status = "UNKNOWN";
    reasons.push(
      "A Frontier flights-from page showed a marketed sample. That is not a timetable and does not confirm current service.",
    );
  } else if (announcements.length > 0) {
    status = "UNKNOWN";
    reasons.push("Announcement evidence is not enough to confirm current service.");
  } else {
    status = "UNKNOWN";
    reasons.push("There is not enough information.");
  }

  if (confidence === "HIGH") {
    reasons.push("Confidence is high because a Frontier schedule snapshot and an official announcement agree.");
  } else if (confidence === "MEDIUM") {
    reasons.push("Confidence is medium because a current schedule snapshot exists without a matching announcement.");
  } else if (confidence === "LOW") {
    reasons.push("Confidence is low because the only schedule evidence is a secondary timetable.");
  } else if (confidence === "CONFLICTING") {
    reasons.push("Confidence is conflicting because sources do not agree. Neither date is treated as the fact.");
  } else {
    reasons.push("Confidence is unknown because the evidence is not sufficient to confirm current service.");
  }

  const latestMarketed = maxDate(
    marketed.map((sample) => sample.marketedDate).filter((date): date is string => Boolean(date)),
  );
  const lastVerifiedAt =
    maxDate(current.map((observation) => observation.retrievedAt)) ?? previous?.lastVerifiedAt ?? null;

  return {
    origin,
    destination,
    status,
    confidence,
    endConfirmed,
    reasons,
    firstSeenAt: previous?.firstSeenAt ?? input.now,
    lastSeenAt: input.now,
    firstScheduledDeparture: firstFlight,
    lastScheduledDeparture: lastFlight,
    announcedStartDate: announcedStart,
    announcedEndDate: announcedEnd ?? (uniqueEnds.length > 1 ? null : announcedEnd),
    announcedFrequencyPerWeek: announcedFrequency,
    currentFrequencyPerWeek: currentFrequency,
    previousFrequencyPerWeek: previous?.previousFrequencyPerWeek ?? null,
    scheduleDays,
    scheduleHorizon: windowEnd,
    lastVerifiedAt,
    disagreements,
    launchUnverified,
    suspectedEndDate: endConfirmed ? announcedEnd : null,
    seasonal,
    latestMarketedDeparture: latestMarketed,
    sources: current.map(evidence),
  };
}

export function pairKey(origin: string, destination: string) {
  return routeKey(origin.toUpperCase(), destination.toUpperCase());
}
