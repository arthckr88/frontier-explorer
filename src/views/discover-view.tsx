"use client";

import { AppLink } from "@/components/app-link";
import { staticDiscover } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function DiscoverView({ catalog, from, stops }: { catalog: StaticCatalog; from: string; stops: number }) {
  const maxStops = stops === 0 || stops === 2 ? stops : 1;
  const data = staticDiscover(catalog, from || "OAK", maxStops);
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Discover from {data.from}</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">Airports you can reach on stored nonstop routes. A connection here is not drawn as its own nonstop.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {["OAK", "SFO", "LAS"].map((code) => (
          <AppLink key={code} href={`/discover?from=${code}&stops=${maxStops}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">
            {code}
          </AppLink>
        ))}
        {[0, 1, 2].map((value) => (
          <AppLink key={value} href={`/discover?from=${data.from}&stops=${value}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">
            {value === 0 ? "Nonstop" : `Within ${value} stop${value === 1 ? "" : "s"}`}
          </AppLink>
        ))}
      </div>
      {data.groups.every((group) => group.items.length === 0) ? (
        <p className="text-sm text-[#8b9790]">No stored route leaves {data.from}.</p>
      ) : (
        data.groups.map((group) => (
          <div key={group.stop}>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">
              {group.stop === 0 ? "Nonstop" : `${group.stop} stop`}
            </h2>
            <div className="flex flex-wrap gap-2">
              {group.items.map((airport) => (
                <AppLink key={airport.iata} href={`/airports/${airport.iata}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">
                  {airport.iata} <span className="text-[#8b9790]">{airport.city}</span>
                </AppLink>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
