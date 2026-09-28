import { formatDay, staticDiagnostics } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function DataView({ catalog }: { catalog: StaticCatalog }) {
  const data = staticDiagnostics(catalog);
  const fares = catalog.fares;
  const nonstopFares = fares.filter((fare) => (fare.stops ?? 0) === 0).length;
  const connectionFares = fares.filter((fare) => (fare.stops ?? 0) > 0).length;
  const scheduleOnly = catalog.network.official?.discrepancies?.length ?? 0;
  const historical = catalog.historical;
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium">Data</h1>
        <p id="provenance" className="max-w-2xl text-sm text-[#8b9790]">
          Counts below are the published layers. A candidate market is not a nonstop. FlightAware is not a source.
        </p>
      </header>
      <Layer title="Network" detail="Frontier-owned directs from flights-from fare modules.">
        <Fact label="Official airports" value={String(data.officialAirports)} />
        <Fact label="Official directs" value={String(data.officialDirects)} />
        <Fact label="Candidate markets" value={String(data.listedCandidates)} />
        <Fact label="Unresolved mappings" value={String(data.unresolved)} />
        <Fact label="Schedule-confirmed only" value={String(scheduleOnly)} />
        <Fact label="Last official refresh" value={data.lastOfficialRefresh ? formatDay(data.lastOfficialRefresh.slice(0, 10)) : "—"} />
      </Layer>
      <Layer title="Schedule" detail="Dated nonstops from the local browser collector.">
        <Fact label="Flight observations" value={String(data.observations)} />
        <Fact label="Schedule-confirmed routes" value={String(data.confirmedPairs)} />
        <Fact label="Checks" value={String(data.checks)} />
        <Fact label="Checked empty" value={String(data.empty)} />
        <Fact label="Blocked" value={String(data.blocked)} />
        <Fact label="Unchecked" value={String(data.unchecked)} />
        <Fact label="Horizon" value={data.scheduleStart && data.scheduleThrough ? `${formatDay(data.scheduleStart)} – ${formatDay(data.scheduleThrough)}` : "—"} />
        <Fact label="Last browser collection" value={data.lastBrowserCollection ? formatDay(data.lastBrowserCollection.slice(0, 10)) : "—"} />
      </Layer>
      <Layer title="Fares" detail="FlightData from the same local browser check. Standard, Discount Den, and GoWild stay separate.">
        <Fact label="Fare observations" value={String(data.fares)} />
        <Fact label="Nonstop fares" value={String(nonstopFares)} />
        <Fact label="Connection fares" value={String(connectionFares)} />
        <Fact label="Price history" value={String(data.priceHistory)} />
      </Layer>
      <Layer
        title="Historical DOT/BTS"
        detail={
          historical?.popularity.passengersStored
            ? `DOT/BTS passenger totals are loaded. ${historical.popularity.periodStart} through ${historical.popularity.periodEnd}. ${historical.popularity.routes.length} directed routes. ${historical.popularity.note}`
            : (historical?.popularity.note ?? "Historical metrics are not loaded.")
        }
      >
        <Fact label="Historical frequency period" value={historical?.frequency.historicalPeriod ?? "—"} />
        <Fact label="Historical popularity period" value={historical?.popularity.period ?? "—"} />
        <Fact label="Passenger routes" value={String(historical?.popularity.routes.length ?? 0)} />
        <Fact
          label="Passenger totals"
          value={
            historical?.popularity.passengersStored
              ? `DOT/BTS passenger totals are loaded. ${historical.popularity.periodStart} through ${historical.popularity.periodEnd}. ${historical.popularity.routes.length} directed routes.`
              : "not loaded"
          }
        />
      </Layer>
      <Layer title="GitHub research" detail="Schema only. GWsearch is CC BY-NC-ND and is not copied. FrontierWildWatch is not a runtime after HTTP 406. No tokens. No GoWild-then-Standard fallback.">
        <Fact label="Runtime dependence" value="none" />
      </Layer>
      <Layer title="Paid sources" detail="None.">
        <Fact label="Paid providers" value="none" />
      </Layer>
      <ul className="space-y-2 text-sm text-[#c5d0c9]">
        <li>Blocked is not an empty schedule. Unchecked is not an empty schedule.</li>
        <li>A connection or a listed market does not create a nonstop route.</li>
        <li>A GoWild value of -1 is not a price.</li>
        <li>Frequency: {data.frequency} One date is not a weekly frequency.</li>
        <li>Statuses stay separate: OFFICIAL_DIRECT, SCHEDULE_CONFIRMED, SCHEDULE_CONFIRMED_ONLY, OFFICIAL_ONLY, FUTURE_ONLY, CHECKED_EMPTY, BLOCKED, UNCHECKED, STALE, CANDIDATE_ONLY.</li>
      </ul>
    </section>
  );
}

function Layer({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="max-w-2xl text-sm text-[#8b9790]">{detail}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
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
