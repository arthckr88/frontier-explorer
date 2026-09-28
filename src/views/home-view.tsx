"use client";

import { useState } from "react";
import { ExplorerMap } from "@/components/explorer-map";
import { AppLink } from "@/components/app-link";
import { SearchPanel } from "@/views/search-panel";
import { formatDay } from "@/static/adapter";
import type { NetworkModel } from "@/static/adapter";
import type { FareQuery, StaticCatalog } from "@/static/types";
import type { UntimedPath } from "@/lib/graph/untimed";

export function HomeView({
  catalog,
  network,
  initial,
}: {
  catalog: StaticCatalog;
  network: NetworkModel;
  initial: FareQuery | null;
}) {
  const routeKey = `${initial?.origin ?? ""}|${initial?.destination ?? ""}|${initial?.date ?? ""}`;
  const [submitted, setSubmitted] = useState<{ key: string; query: FareQuery } | null>(null);
  const query = submitted?.key === routeKey ? submitted.query : initial;
  const searching = Boolean(query?.origin && query?.destination && query?.date);
  return (
    <div className="space-y-3 sm:space-y-4">
      <SearchPanel key={routeKey} catalog={catalog} initial={query} onSearch={(next) => setSubmitted({ key: routeKey, query: next })} />
      {searching ? null : (
        <>
          <ExplorerMap tileStyle={network.tileStyle} routes={network.routes} airports={network.airports} interest={network.interest} />
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Card title="Airports" href="/discover">
              {network.home.airports.length === 0 ? (
                <Empty>No airports on this network.</Empty>
              ) : (
                <div className="flex flex-wrap gap-2 font-mono text-xs">
                  {network.home.airports.map((airport) => (
                    <AppLink key={airport.iata} href={`/airports/${airport.iata}`} className="rounded border border-[#24302a] px-2 py-1 hover:border-[#3dbe7a]">
                      {airport.iata}
                    </AppLink>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Bay Area → Southern California" href="/planner?module=bay-la" id="bay-area-southern-california">
              <PathList paths={network.home.bayLa} empty="No path from the Bay Area to Southern California." />
            </Card>
            <Card title="Bay Area → New York" href="/planner?module=bay-ny">
              <PathList paths={network.home.bayNy} empty="No path from the Bay Area to New York." />
            </Card>
            <Card title="Florida" href="/airports/MCO">
              {network.home.florida.length > 0 ? (
                <PathList paths={network.home.florida} empty="" />
              ) : network.home.floridaAirports.length > 0 ? (
                <div className="flex flex-wrap gap-2 font-mono text-sm">
                  {network.home.floridaAirports.map((airport) => (
                    <AppLink key={airport.iata} href={`/airports/${airport.iata}`}>
                      {airport.iata} {airport.city}
                    </AppLink>
                  ))}
                </div>
              ) : (
                <Empty>No path into Florida.</Empty>
              )}
            </Card>
            {network.home.changes.length > 0 ? (
              <Card title="New and changing" href="/changes">
                {network.home.changes.map((change) => (
                  <AppLink key={change.summary} href={change.href} className="block text-sm hover:text-[#3dbe7a]">
                    {change.summary}
                  </AppLink>
                ))}
              </Card>
            ) : null}
          </section>
          <p className="font-mono text-[11px] text-[#8b9790]">
            {network.home.scheduleThrough ? `Schedule through ${formatDay(network.home.scheduleThrough)}.` : "No schedule yet."}{" "}
            A fare stays on the date it was checked.{" "}
            <AppLink href="/routes/LAS/BUR" className="text-[#e7ece8] underline">
              LAS → BUR
            </AppLink>
          </p>
        </>
      )}
    </div>
  );
}

function Card({ title, href, id, children }: { title: string; href: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-md border border-[#24302a] bg-[#12161b] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">{title}</h2>
        <AppLink href={href} className="text-xs text-[#3dbe7a]">
          Open
        </AppLink>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#8b9790]">{children}</p>;
}

function PathList({ paths, empty }: { paths: UntimedPath[]; empty: string }) {
  if (paths.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-1 text-sm">
      {paths.map((path) => (
        <li key={path.airports.join("-")} className="font-mono text-xs">
          {path.airports.join(" → ")} · {path.stops === 0 ? "Nonstop" : `${path.stops} stop${path.stops === 1 ? "" : "s"}`}
        </li>
      ))}
    </ul>
  );
}
