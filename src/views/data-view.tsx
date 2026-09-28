import { formatDay, staticDiagnostics } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function DataView({ catalog }: { catalog: StaticCatalog }) {
  const data = staticDiagnostics(catalog);
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Data</h1>
        <p id="provenance" className="max-w-2xl text-sm text-[#8b9790]">
          Source: {data.source}.{" "}
          <a className="text-[#3dbe7a]" href={data.sourceUrl}>
            Frontier booking site
          </a>
          . FlightAware is not a source. This page is the diagnostics view.
        </p>
      </header>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Official airports" value={String(data.officialAirports)} />
        <Fact label="Official directs" value={String(data.officialDirects)} />
        <Fact label="Candidate markets" value={String(data.listedCandidates)} />
        <Fact label="Schedule-confirmed routes" value={String(data.confirmedPairs)} />
        <Fact label="Flight observations" value={String(data.observations)} />
        <Fact label="Fare observations" value={String(data.fares)} />
        <Fact label="Price history" value={String(data.priceHistory)} />
        <Fact label="Checks" value={String(data.checks)} />
        <Fact label="Checked empty" value={String(data.empty)} />
        <Fact label="Blocked" value={String(data.blocked)} />
        <Fact label="Unchecked" value={String(data.unchecked)} />
        <Fact label="Horizon" value={data.scheduleStart && data.scheduleThrough ? `${formatDay(data.scheduleStart)} – ${formatDay(data.scheduleThrough)}` : "—"} />
        <Fact label="Last official refresh" value={data.lastOfficialRefresh ? formatDay(data.lastOfficialRefresh.slice(0, 10)) : "—"} />
        <Fact label="Last browser collection" value={data.lastBrowserCollection ? formatDay(data.lastBrowserCollection.slice(0, 10)) : "—"} />
        <Fact label="Unresolved mappings" value={String(data.unresolved)} />
      </dl>
      <ul className="space-y-2 text-sm text-[#c5d0c9]">
        <li>Blocked is not an empty schedule. Unchecked is not an empty schedule.</li>
        <li>A connection or a listed market does not create a nonstop route.</li>
        <li>A GoWild value of -1 is not a price.</li>
        <li>Frequency: {data.frequency} One date is not a weekly frequency.</li>
        <li>Popularity is hidden. Historical passengers are not loaded, and passenger totals do not create a current route.</li>
        <li>Statuses stay separate: OFFICIAL_DIRECT, SCHEDULE_CONFIRMED, FUTURE_ONLY, CHECKED_EMPTY, BLOCKED, UNCHECKED, STALE, CANDIDATE_ONLY.</li>
      </ul>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#24302a] p-3">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-[#8b9790]">{label}</dt>
      <dd className="mt-1 font-mono text-lg">{value}</dd>
    </div>
  );
}
