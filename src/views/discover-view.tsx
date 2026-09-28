"use client";

import { useState } from "react";
import { AppLink } from "@/components/app-link";
import { staticDirectory, type DirectoryFilters } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

const EMPTY: DirectoryFilters = {
  region: "all",
  country: "",
  scope: "all",
  origin: "",
  destination: "",
  officialOnly: false,
  confirmedOnly: false,
  faresOnly: false,
  query: "",
};

export function DiscoverView({ catalog, from = "" }: { catalog: StaticCatalog; from?: string; stops?: number }) {
  const [filters, setFilters] = useState<DirectoryFilters>({ ...EMPTY, origin: from.trim().toUpperCase() });
  const data = staticDirectory(catalog, filters);
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Discover</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">
          Every Frontier airport and direct route in the official catalogue. A candidate market is not listed here as a nonstop.
        </p>
      </header>
      <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input aria-label="Search airports and routes" value={filters.query} placeholder="City or airport" onChange={(event) => setFilters({ ...filters, query: event.target.value })} className={field} />
        <select aria-label="Region" value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })} className={field}>
          <option value="all">All regions</option>
          {data.regions.map((region) => (
            <option key={region} value={region}>{region.replaceAll("_", " ")}</option>
          ))}
        </select>
        <input aria-label="Country" value={filters.country} placeholder="Country (US)" maxLength={2} onChange={(event) => setFilters({ ...filters, country: event.target.value.toUpperCase() })} className={field} />
        <select aria-label="Domestic or international" value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value as DirectoryFilters["scope"] })} className={field}>
          <option value="all">Domestic and international</option>
          <option value="domestic">Domestic</option>
          <option value="international">International</option>
        </select>
        <input aria-label="Origin" value={filters.origin} placeholder="Origin" maxLength={3} onChange={(event) => setFilters({ ...filters, origin: event.target.value.toUpperCase() })} className={field} />
        <input aria-label="Destination" value={filters.destination} placeholder="Destination" maxLength={3} onChange={(event) => setFilters({ ...filters, destination: event.target.value.toUpperCase() })} className={field} />
        <label className="flex items-center gap-2 text-sm text-[#8b9790]"><input type="checkbox" checked={filters.officialOnly} onChange={(event) => setFilters({ ...filters, officialOnly: event.target.checked })} /> Official only</label>
        <label className="flex items-center gap-2 text-sm text-[#8b9790]"><input type="checkbox" checked={filters.confirmedOnly} onChange={(event) => setFilters({ ...filters, confirmedOnly: event.target.checked })} /> Schedule-confirmed</label>
        <label className="flex items-center gap-2 text-sm text-[#8b9790]"><input type="checkbox" checked={filters.faresOnly} onChange={(event) => setFilters({ ...filters, faresOnly: event.target.checked })} /> Routes with fares</label>
      </form>
      <p className="font-mono text-xs text-[#8b9790]">{data.airports.length} airports · {data.routes.length} directs</p>
      <div className="flex flex-wrap gap-2">
        {data.airports.map((airport) => (
          <AppLink key={airport.iata} href={`/airports/${airport.iata}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">
            {airport.iata} <span className="text-[#8b9790]">{airport.city}</span>
          </AppLink>
        ))}
      </div>
      <div className="max-h-[480px] space-y-1 overflow-auto">
        {data.routes.map((route) => (
          <AppLink key={`${route.origin}${route.destination}`} href={`/routes/${route.origin}/${route.destination}`} className="flex justify-between gap-3 rounded border border-[#24302a] px-2 py-1 text-sm hover:text-[#3dbe7a]">
            <span>{route.origin} → {route.destination}</span>
            <span className="font-mono text-[11px] text-[#8b9790]">
              {route.official ? "Official direct" : "Dated schedule"}
              {route.confirmed ? " · dated schedule" : ""}
              {route.fares ? " · fares" : ""}
            </span>
          </AppLink>
        ))}
      </div>
    </section>
  );
}

const field = "rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-2 text-sm";
