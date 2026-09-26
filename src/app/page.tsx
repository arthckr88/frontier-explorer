import Link from "next/link";
import { ExplorerMap } from "@/components/explorer-map";
import { StatusBadge } from "@/components/status-badge";
import { TripSearch } from "@/components/trip-search";
import { moduleOptions, readDashboard, readFreshness, readNetwork, tileStyle } from "@/server/queries/read";
import { timingCopy } from "@/lib/time/copy";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string }>;
}) {
  const params = await searchParams;
  const searching = Boolean(params.from || params.to || params.date);
  if (searching) {
    return (
      <div className="space-y-4">
        <TripSearch action="/" from={params.from} to={params.to} date={params.date} />
      </div>
    );
  }
  const [network, dashboard, freshness] = await Promise.all([
    readNetwork().catch((error: Error) => ({ dbError: error.message, routes: [], airports: [] })),
    readDashboard().catch(() => null),
    readFreshness().catch(() => null),
  ]);
  const routes = dashboard?.routes ?? [];
  const today = dashboard?.today ?? new Date().toISOString().slice(0, 10);
  const bayLa = moduleOptions(routes, ["OAK", "SFO"], ["LAX", "BUR"], 1);
  const bayNy = moduleOptions(routes, ["OAK", "SFO"], ["LGA", "JFK"], 2);
  const upcoming = routes.filter((route) => route.status === "ANNOUNCED" || route.status === "UPCOMING");
  const ending = routes.filter((route) => route.status === "ENDING_SOON");
  const disappearing = routes.filter((route) => route.status === "POSSIBLY_ENDING" || route.status === "STALE");
  const frequent = [...routes]
    .filter((route) => route.currentFrequencyPerWeek != null)
    .sort((a, b) => (b.currentFrequencyPerWeek ?? 0) - (a.currentFrequencyPerWeek ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <TripSearch action="/" from={params.from} to={params.to} date={params.date} />
      {network.dbError ? (
        <p className="rounded-md border border-[#e2a84a]/40 bg-[#181e24] px-3 py-2 text-sm text-[#e2a84a]">{network.dbError}</p>
      ) : null}
      <ExplorerMap
        tileStyle={tileStyle()}
        routes={network.routes}
        airports={network.airports}
        interest={dashboard?.preferences.heavyInterest ?? ["OAK", "SFO", "LAS", "LAX", "BUR"]}
      />
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card title="My network" href="/discover">
          <p className="text-sm text-[#8b9790]">OAK, SFO, LAS, LAX, BUR, New York, Orlando. SJC is nearby, not home.</p>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-xs">
            {["OAK", "SFO", "LAS", "LAX", "BUR", "LGA", "JFK", "MCO", "FLL", "MIA"].map((code) => (
              <Link key={code} href={`/airports/${code}`} className="rounded border border-[#24302a] px-2 py-1 hover:border-[#3dbe7a]">
                {code}
              </Link>
            ))}
          </div>
        </Card>
        <Card title="Bay Area → Los Angeles" href="/planner?module=bay-la">
          <PathList paths={bayLa} empty="No announcement or schedule path is loaded between these airports." />
        </Card>
        <Card title="Bay Area → New York" href="/planner?module=bay-ny">
          <PathList paths={bayNy} empty="No non-red-eye timetable is loaded. The graph is not pinned to a hub list." />
        </Card>
        <Card title="Florida" href="/airports/MCO">
          <div className="flex gap-2 font-mono text-sm">
            <Link href="/airports/MCO">MCO primary</Link>
            <Link href="/airports/FLL">FLL</Link>
            <Link href="/airports/MIA">MIA</Link>
          </div>
        </Card>
        <Card title="Most frequent" href="/rankings/frequency">
          {frequent.length === 0 ? <Empty>Scheduled departures per week appear only after a timetable observation.</Empty> : frequent.map((route) => (
            <Link key={`${route.origin}${route.destination}`} href={`/routes/${route.origin}/${route.destination}`} className="flex justify-between text-sm">
              <span>{route.origin} → {route.destination}</span>
              <span className="font-mono">{route.currentFrequencyPerWeek}/wk</span>
            </Link>
          ))}
        </Card>
        <Card title="Most popular" href="/rankings/popularity">
          {(dashboard?.popular.length ?? 0) === 0 ? <Empty>No BTS passenger period is stored.</Empty> : dashboard?.popular.slice(0, 5).map((row) => (
            <div key={`${row.origin}${row.destination}${row.periodLabel}`} className="text-sm">
              <div className="flex justify-between"><span>{row.origin} → {row.destination}</span><span className="font-mono">{row.value.toLocaleString()}</span></div>
              <div className="text-[11px] text-[#8b9790]">{row.periodLabel}</div>
            </div>
          ))}
        </Card>
        <Card title="New and changing" href="/changes">
          {(dashboard?.changes.length ?? 0) === 0 ? <Empty>Change events are written by reconciliation. Nothing has been emitted.</Empty> : dashboard?.changes.slice(0, 5).map((change) => (
            <Link key={`${change.detectedAt}${change.summary}`} href={`/routes/${change.origin}/${change.destination}`} className="block text-sm">
              <span className="font-mono text-[10px] uppercase text-[#8b9790]">{change.type}</span>
              <div>{change.summary}</div>
            </Link>
          ))}
        </Card>
        <Card title="Starting soon" href="/changes">
          {upcoming.length === 0 ? <Empty>No announced future starts are stored.</Empty> : upcoming.slice(0, 6).map((route) => (
            <Link key={`${route.origin}${route.destination}`} href={`/routes/${route.origin}/${route.destination}`} className="flex items-center justify-between gap-2 text-sm">
              <span>{route.origin} → {route.destination}</span>
              <span className="text-[#3ec6d4]">{timingCopy(route, today) ?? route.status}</span>
            </Link>
          ))}
        </Card>
        <Card title="Ending or unverified" href="/changes">
          {ending.length + disappearing.length === 0 ? <Empty>No route is marked ending, possibly ending, or stale.</Empty> : [...ending, ...disappearing].slice(0, 6).map((route) => (
            <Link key={`${route.origin}${route.destination}${route.status}`} href={`/routes/${route.origin}/${route.destination}`} className="block text-sm">
              <StatusBadge value={route.status} /> {route.origin} → {route.destination}
              <div className="text-[#8b9790]">{timingCopy(route, today)}</div>
            </Link>
          ))}
        </Card>
      </section>
      <p className="font-mono text-[11px] text-[#8b9790]">
        {freshness?.latestAt ? `Last sync ${freshness.latestAt}.` : "Sync has not run."} Schedule-confirmed routes, announcement routes, and BTS popularity are kept distinct.
        {" "}
        <Link href="/routes/LAS/BUR" className="text-[#e7ece8] underline">LAS → BUR watch</Link>
      </p>
    </div>
  );
}

function Card({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#24302a] bg-[#12161b] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">{title}</h2>
        <Link href={href} className="text-xs text-[#3dbe7a]">Open</Link>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#8b9790]">{children}</p>;
}

function PathList({ paths, empty }: { paths: { airports: string[]; statuses: string[]; stops: number }[]; empty: string }) {
  if (paths.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-1 text-sm">
      {paths.slice(0, 4).map((path) => (
        <li key={path.airports.join("-")} className="font-mono text-xs">
          {path.airports.join(" → ")} · {path.stops} stop{path.stops === 1 ? "" : "s"} · {path.statuses.join(", ")}
        </li>
      ))}
    </ul>
  );
}
