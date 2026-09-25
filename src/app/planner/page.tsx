import Link from "next/link";
import { parseTripQuery, frontierSearchUrl } from "@/lib/airports/places";
import { moduleOptions, planItineraries, readDashboard, readPreferences } from "@/server/queries/read";

const MODULES = {
  "bay-la": { label: "Bay Area → Los Angeles", origins: ["OAK", "SFO"], destinations: ["LAX", "BUR"], query: "Bay Area → LA" },
  "bay-ny": { label: "Bay Area → New York", origins: ["OAK", "SFO"], destinations: ["LGA", "JFK"], query: "Bay Area → New York" },
  florida: { label: "Florida", origins: ["OAK", "SFO"], destinations: ["MCO", "FLL", "MIA"], query: "Bay Area → South Florida" },
} as const;

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; date?: string; module?: string; unusual?: string; nearby?: string; redeye?: string }>;
}) {
  const params = await searchParams;
  const preferences = await readPreferences();
  const moduleKey = params.module && params.module in MODULES ? (params.module as keyof typeof MODULES) : null;
  const selected = moduleKey ? MODULES[moduleKey] : null;
  const includeNearby = params.nearby === "1" || preferences.includeNearby;
  const parsed = parseTripQuery(params.q || selected?.query || "OAK → LAX", includeNearby);
  const origins: string[] = parsed.origin?.kind === "airports" ? [...parsed.origin.used] : selected ? [...selected.origins] : ["OAK"];
  const destinations: string[] =
    parsed.destination?.kind === "airports" ? [...parsed.destination.used] : selected ? [...selected.destinations] : ["LAX"];
  const region = parsed.destination?.kind === "region" ? parsed.destination.region : null;
  const date = params.date || new Date().toISOString().slice(0, 10);
  const excludeRedEyes = params.redeye === "0" ? false : preferences.excludeRedEyes;
  const dashboard = await readDashboard().catch(() => null);
  const untimed = moduleOptions(dashboard?.routes ?? [], origins, destinations, preferences.maxStops);
  const planned = region
    ? { itineraries: [], notice: `Destination is the ${parsed.destination?.label} region. Pick a specific airport from the map or search.` }
    : await planItineraries({
        origins,
        destinations,
        date,
        unusual: params.unusual === "1",
        preferences: { ...preferences, excludeRedEyes, includeNearby },
      });

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Planner</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">Timed itineraries use stored flight instances only. Overnight Las Vegas ground time stays visible when intentional stopovers are on. Red-eyes are excluded by default.</p>
      </header>
      <form className="grid gap-2 rounded-md border border-[#24302a] bg-[#12161b] p-3 md:grid-cols-[1fr_180px_auto]" action="/planner">
        <input name="q" defaultValue={params.q || selected?.query || "OAK → LAX"} className="rounded border border-[#24302a] bg-[#090b0d] px-3 py-2 text-sm" aria-label="Trip" />
        <input name="date" type="date" defaultValue={date} className="rounded border border-[#24302a] bg-[#090b0d] px-3 py-2 text-sm" />
        <button className="rounded bg-[#3dbe7a] px-3 py-2 text-sm text-[#090b0d]" type="submit">Search</button>
        <label className="flex items-center gap-2 text-sm text-[#8b9790]"><input type="checkbox" name="nearby" value="1" defaultChecked={includeNearby} /> Include nearby airports</label>
        <label className="flex items-center gap-2 text-sm text-[#8b9790]"><input type="checkbox" name="redeye" value="0" defaultChecked={!excludeRedEyes} /> Allow red-eyes</label>
        <label className="flex items-center gap-2 text-sm text-[#8b9790]"><input type="checkbox" name="unusual" value="1" defaultChecked={params.unusual === "1"} /> Routes I probably have not considered</label>
        {moduleKey ? <input type="hidden" name="module" value={moduleKey} /> : null}
      </form>
      <div className="flex flex-wrap gap-2 text-sm">
        {Object.entries(MODULES).map(([id, item]) => (
          <Link key={id} href={`/planner?module=${id}`} className="rounded border border-[#24302a] px-2 py-1">{item.label}</Link>
        ))}
      </div>
      <p className="font-mono text-xs text-[#8b9790]">
        Using {origins.join(", ")} → {destinations.join(", ")}
        {parsed.origin?.kind === "airports" && parsed.origin.nearby.length ? ` · nearby not in this search: ${includeNearby ? "included" : parsed.origin.nearby.join(", ")}` : ""}
        {parsed.destination?.kind === "airports" && !includeNearby && parsed.destination.nearby.length ? ` · optional nearby destinations ${parsed.destination.nearby.join(", ")}` : ""}
      </p>
      {planned.notice ? <p className="rounded border border-[#e2a84a]/40 p-3 text-sm">{planned.notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Timed options</h2>
          {planned.itineraries.length === 0 ? <p className="text-sm text-[#8b9790]">No timed itinerary matched.</p> : planned.itineraries.slice(0, 12).map((itinerary) => (
            <article key={itinerary.id} className="mb-3 rounded border border-[#24302a] p-3 text-sm">
              <div className="font-mono">{itinerary.segments.map((segment) => `${segment.origin} ${segment.departureLocal.slice(11, 16)}→${segment.destination} ${segment.arrivalLocal.slice(11, 16)}`).join(" · ")}</div>
              <p className="mt-1 text-[#8b9790]">{itinerary.stops} stops · {Math.round(itinerary.elapsedMinutes / 60)}h elapsed · score {itinerary.score}</p>
              {itinerary.connections.map((connection) => <p key={connection.airport}>{connection.label}</p>)}
              <ul className="mt-2 space-y-1 text-xs text-[#8b9790]">
                {itinerary.factors.map((factor) => <li key={factor.id}>{factor.label}: {factor.points > 0 ? "+" : ""}{factor.points} · {factor.detail}</li>)}
              </ul>
              <a className="mt-2 inline-block text-[#3dbe7a]" href={frontierSearchUrl(itinerary.segments[0]?.origin ?? origins[0] ?? "OAK", itinerary.segments.at(-1)?.destination ?? destinations[0] ?? "LAX", date)}>Search on Frontier</a>
            </article>
          ))}
        </div>
        <div>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Observed paths without times</h2>
          <p className="mb-2 text-xs text-[#8b9790]">These come from stored route observations. They are not proof a connection operates on {date}.</p>
          {untimed.length === 0 ? <p className="text-sm text-[#8b9790]">No stored path connects these airports.</p> : untimed.slice(0, 12).map((path) => (
            <div key={path.airports.join("-")} className="mb-2 font-mono text-xs">{path.airports.join(" → ")} · {path.statuses.join(" / ")}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
