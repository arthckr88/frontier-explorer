import Link from "next/link";
import { parseTripQuery } from "@/lib/airports/places";
import { searchAirports } from "@/server/queries/read";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const parsed = query ? parseTripQuery(query, true) : null;
  const trip = Boolean(parsed?.origin && parsed.destination);
  const rows = query && !trip ? await searchAirports(query) : [];

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Search</h1>
        <p className="text-sm text-[#8b9790]">
          Airport groups name the physical airports they use. Nearby airports stay labeled as nearby.
        </p>
      </header>
      <form action="/search" className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="OAK → LAX, Bay Area → New York, Caribbean"
          className="flex-1 rounded border border-[#24302a] bg-[#12161b] px-3 py-2 text-sm"
          aria-label="Search"
        />
        <button className="rounded bg-[#3dbe7a] px-3 py-2 text-sm text-[#090b0d]" type="submit">
          Search
        </button>
      </form>
      {parsed?.origin?.kind === "airports" && parsed.destination?.kind === "airports" ? (
        <PlaceCard title="Trip" place={parsed.origin} other={parsed.destination} query={query} />
      ) : null}
      {parsed && !trip && parsed.destination?.kind === "airports" ? (
        <PlaceBlock place={parsed.destination} />
      ) : null}
      {parsed?.destination?.kind === "region" ? (
        <p className="text-sm">
          {parsed.destination.label} is a region filter, not an airport. Open the map and choose {parsed.destination.label}.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((airport) => (
            <li key={airport.iata}>
              <Link href={`/airports/${airport.iata}`} className="flex justify-between rounded border border-[#24302a] px-3 py-2 text-sm hover:border-[#3dbe7a]">
                <span>
                  <span className="font-mono">{airport.iata}</span> · {airport.city}
                </span>
                <span className="text-[#8b9790]">{airport.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {query && !trip && parsed?.destination?.kind !== "airports" && parsed?.destination?.kind !== "region" && rows.length === 0 ? (
        <p className="text-sm text-[#8b9790]">No airport reference matched that text.</p>
      ) : null}
    </section>
  );
}

function PlaceBlock({
  place,
}: {
  place: { label: string; primary: string[]; nearby: string[]; used: string[] };
}) {
  return (
    <div className="rounded border border-[#24302a] p-3 text-sm">
      <div className="font-medium">{place.label}</div>
      <p className="mt-1">Primary: {place.primary.join(", ")}</p>
      {place.nearby.length > 0 ? <p className="text-[#8b9790]">Nearby, not preferred: {place.nearby.join(", ")}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {place.used.map((code) => (
          <Link key={code} href={`/airports/${code}`} className="font-mono text-[#3dbe7a]">
            {code}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PlaceCard({
  title,
  place,
  other,
  query,
}: {
  title: string;
  place: { label: string; primary: string[]; nearby: string[] };
  other: { label: string; primary: string[]; nearby: string[] };
  query: string;
}) {
  return (
    <div className="space-y-3 rounded border border-[#24302a] p-3 text-sm">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">{title}</div>
      <p>
        {place.label} ({place.primary.join(", ")}
        {place.nearby.length ? `; nearby ${place.nearby.join(", ")}` : ""}) → {other.label} ({other.primary.join(", ")}
        {other.nearby.length ? `; nearby ${other.nearby.join(", ")}` : ""})
      </p>
      <Link className="text-[#3dbe7a]" href={`/planner?q=${encodeURIComponent(query)}`}>
        Open in the planner
      </Link>
    </div>
  );
}
