import { TripForm } from "@/components/trip-form";
import { frontierSearchUrl } from "@/lib/airports/places";
import { readPreferences, planItineraries } from "@/server/queries/read";
import { coverLiveSearch, type LiveSearchReport } from "@/server/search/live";
import type { Itinerary } from "@/lib/graph/search";

const CODE = /^[A-Za-z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function TripSearch({
  action,
  from,
  to,
  date,
}: {
  action: string;
  from?: string;
  to?: string;
  date?: string;
}) {
  const origin = (from ?? "").trim().toUpperCase();
  const destination = (to ?? "").trim().toUpperCase();
  const day = (date ?? "").trim();
  const submitted = Boolean(from || to || date);
  const valid = CODE.test(origin) && CODE.test(destination) && origin !== destination && DAY.test(day);
  let notice: string | null = null;
  let itineraries: Itinerary[] = [];
  let report: LiveSearchReport | null = null;

  if (submitted && !valid) {
    notice = "Enter two different airport codes and a date.";
  } else if (valid) {
    const preferences = await readPreferences();
    report = await coverLiveSearch({
      origin,
      destination,
      date: day,
      maxStops: preferences.maxStops,
      allowVegasOvernight: preferences.allowIntentionalStopover && preferences.preferVegasStopover,
    });
    const planned = await planItineraries({
      origins: [origin],
      destinations: [destination],
      date: day,
      preferences,
    });
    itineraries = planned.itineraries;
    notice = searchNotice(origin, destination, day, report, itineraries.length, planned.notice);
  }

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium">Search Frontier</h1>
        <p className="text-sm text-[#8b9790]">
          One origin, one destination, one date. If that day is not saved yet, this search asks Frontier for it.
        </p>
      </header>
      <TripForm action={action} from={origin} to={destination} date={day} />
      {notice ? <p className="rounded-md border border-[#e2a84a]/40 bg-[#181e24] px-3 py-3 text-sm">{notice}</p> : null}
      {report && (report.fetched.length > 0 || report.cached.length > 0) ? (
        <p className="font-mono text-[11px] text-[#8b9790]">
          {report.fetched.length > 0 ? `Fetched from Frontier: ${report.fetched.join(", ")}. ` : ""}
          {report.cached.length > 0 ? `Already saved: ${report.cached.join(", ")}.` : ""}
        </p>
      ) : null}
      {valid && itineraries.length > 0 ? (
        <div className="space-y-3">
          {itineraries.slice(0, 12).map((itinerary) => (
            <ItineraryCard key={itinerary.id} itinerary={itinerary} date={day} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ItineraryCard({ itinerary, date }: { itinerary: Itinerary; date: string }) {
  const vegas = itinerary.connections.some((connection) => connection.vegasOvernight);
  const stopLabel = itinerary.stops === 0 ? "Nonstop" : `${itinerary.stops} stop${itinerary.stops === 1 ? "" : "s"}`;
  const first = itinerary.segments[0];
  const last = itinerary.segments.at(-1);
  return (
    <article className="rounded-md border border-[#24302a] bg-[#12161b] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-[#181e24] px-2 py-1 font-medium">{stopLabel}</span>
        {vegas ? <span className="rounded bg-[#3a2a12] px-2 py-1 text-[#e2a84a]">Overnight in Las Vegas</span> : null}
        <span className="text-[#8b9790]">{formatElapsed(itinerary.elapsedMinutes)}</span>
      </div>
      <ol className="space-y-2">
        {itinerary.segments.map((segment) => (
          <li key={segment.id} className="text-base">
            <div className="font-medium">
              {segment.origin} {clock(segment.departureLocal)} → {segment.destination} {clock(segment.arrivalLocal)}
            </div>
            <div className="text-sm text-[#8b9790]">
              {segment.flightNumber ? `${segment.flightNumber} · ` : ""}
              Local times
              {segment.departureLocal.slice(0, 10) !== date ? ` · departs ${segment.departureLocal.slice(0, 10)}` : ""}
            </div>
          </li>
        ))}
      </ol>
      {itinerary.connections.filter((connection) => !connection.vegasOvernight).map((connection) => (
        <p key={`${connection.airport}${connection.minutes}`} className="mt-2 text-sm text-[#8b9790]">
          {connection.label}
        </p>
      ))}
      {first && last ? (
        <a
          className="mt-3 inline-block text-sm text-[#3dbe7a]"
          href={frontierSearchUrl(first.origin, last.destination, date)}
        >
          Open this search on Frontier
        </a>
      ) : null}
    </article>
  );
}

function searchNotice(
  origin: string,
  destination: string,
  date: string,
  report: LiveSearchReport,
  count: number,
  plannedNotice: string | null,
) {
  const route = `${origin} → ${destination} on ${date}`;
  if (report.errors.some((item) => item.detail === "Database is not configured.")) return "Database is not configured.";
  if (count > 0 && report.blocked.length > 0) {
    return `${count === 1 ? "1 itinerary" : `${count} itineraries`} for ${route}. Frontier returned HTTP 406 for ${report.blocked.map((item) => item.leg).join(", ")}. Those legs were left blank.`;
  }
  if (count > 0) return null;
  if (report.blocked.length > 0 && report.fetched.length === 0 && report.cached.length === 0) {
    return `Frontier returned HTTP 406 for ${route}. No flights were invented.`;
  }
  if (report.blocked.length > 0) {
    return `No itinerary for ${route}. Frontier returned HTTP 406 for ${report.blocked.map((item) => item.leg).join(", ")}.`;
  }
  if (report.errors.length > 0 && report.flightsFound === 0) {
    return `Frontier did not return a schedule for ${route}. ${report.errors[0]?.detail ?? ""} No flights were invented.`.replace(/\s+/g, " ").trim();
  }
  if (plannedNotice && report.flightsFound === 0 && report.fetched.length === 0 && report.cached.length === 0) return plannedNotice;
  return `Frontier showed no nonstop or one-stop itinerary for ${route}.`;
}

function clock(local: string) {
  const match = /T(\d{2}):(\d{2})/.exec(local);
  if (!match) return local;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function formatElapsed(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
