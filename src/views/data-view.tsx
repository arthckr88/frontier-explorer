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
        <Fact label="Booking observations" value={String(data.observations)} />
        <Fact label="Confirmed nonstop pairs" value={String(data.confirmedPairs)} />
        <Fact label="Listed market candidates" value={String(data.listedCandidates)} />
        <Fact label="Fare rows" value={String(data.fares)} />
        <Fact label="Price-history rows" value={String(data.priceHistory)} />
        <Fact label="Schedule" value={data.scheduleStart && data.scheduleThrough ? `${formatDay(data.scheduleStart)} – ${formatDay(data.scheduleThrough)}` : "—"} />
        <Fact label="Checked with flights" value={String(data.flightsFound)} />
        <Fact label="Checked empty" value={String(data.empty)} />
        <Fact label="Blocked" value={String(data.blocked)} />
        <Fact label="Unchecked" value={String(data.unchecked)} />
        <Fact label="Change events" value={String(data.changes)} />
      </dl>
      <ul className="space-y-2 text-sm text-[#c5d0c9]">
        <li>Blocked is not an empty schedule. Unchecked is not an empty schedule.</li>
        <li>A connection or a listed market does not create a nonstop route.</li>
        <li>A GoWild value of -1 is not a price.</li>
        <li>Weekly frequency is not published from these checks, so Frequency stays off the main navigation.</li>
        <li>No passenger totals are stored, so Popularity stays off the main navigation.</li>
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
