import Link from "next/link";
import { readDashboard, readNetwork } from "@/server/queries/read";
import { reachable } from "@/lib/graph/arcs";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; stops?: string }>;
}) {
  const params = await searchParams;
  const from = (params.from || "OAK").toUpperCase();
  const stops = Number(params.stops ?? "1");
  const maxStops = stops === 0 || stops === 2 ? stops : 1;
  const dashboard = await readDashboard().catch(() => null);
  const network = await readNetwork().catch(() => ({ routes: [], airports: [], dbError: null }));
  const reached = reachable(
    [from],
    (dashboard?.routes ?? [])
      .filter((route) => route.status !== "UNKNOWN" && route.status !== "ENDED")
      .map((route) => ({ origin: route.origin, destination: route.destination, status: route.status })),
    maxStops,
  );
  const airports = new Map(network.airports.map((airport) => [airport.iata, airport]));
  const grouped = [0, 1, 2].map((stop) => ({
    stop,
    items: [...reached.entries()].filter(([, value]) => value.stops === stop),
  }));
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Discover from {from}</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">Reachability uses announced or schedule-backed directional routes. Marketed flight samples stay off this graph. It is not a timetable and it does not assume a hub.</p>
      </header>
      <form className="flex flex-wrap gap-2" action="/discover">
        {["OAK", "SFO", "LAS"].map((code) => (
          <Link key={code} href={`/discover?from=${code}&stops=${maxStops}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">{code}</Link>
        ))}
        {[0, 1, 2].map((value) => (
          <Link key={value} href={`/discover?from=${from}&stops=${value}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">{value === 0 ? "Nonstop" : `Within ${value} stop${value === 1 ? "" : "s"}`}</Link>
        ))}
      </form>
      {reached.size === 0 ? <p className="text-sm text-[#8b9790]">Nothing observed is reachable from {from} yet.</p> : grouped.filter((group) => group.stop <= maxStops).map((group) => (
        <div key={group.stop}>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">{group.stop === 0 ? "Nonstop" : `${group.stop} stop`}</h2>
          <div className="flex flex-wrap gap-2">
            {group.items.map(([code]) => (
              <Link key={code} href={`/airports/${code}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">
                {code} <span className="text-[#8b9790]">{airports.get(code)?.city}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
