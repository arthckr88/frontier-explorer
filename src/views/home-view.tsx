"use client";

import { useState } from "react";
import { ExplorerMap } from "@/components/explorer-map";
import { SearchPanel } from "@/views/search-panel";
import type { NetworkModel } from "@/static/adapter";
import type { FareQuery, StaticCatalog } from "@/static/types";

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
  const [typed, setTyped] = useState({ key: routeKey, from: initial?.origin ?? "" });
  const query = submitted?.key === routeKey ? submitted.query : initial;
  const typedFrom = typed.key === routeKey ? typed.from : (initial?.origin ?? "");
  const focusAirport = /^[A-Z]{3}$/.test(typedFrom) ? typedFrom : null;
  const selected = query?.origin && query.destination ? { origin: query.origin, destination: query.destination } : null;
  return (
    <div className="relative -my-3 flex h-[calc(100dvh-5.25rem)] min-h-0 flex-col gap-1 overflow-hidden sm:-my-4">
      <SearchPanel
        key={routeKey}
        catalog={catalog}
        initial={query}
        onFromChange={(from) => setTyped({ key: routeKey, from })}
        onSearch={(next) => setSubmitted({ key: routeKey, query: next })}
      />
      <div className="min-h-0 flex-1">
        <ExplorerMap
          tileStyle={network.tileStyle}
          routes={network.routes}
          airports={network.airports}
          interest={network.interest}
          focusAirport={focusAirport}
          selected={selected}
        />
      </div>
    </div>
  );
}
