"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import { LinkModeContext } from "@/components/app-link";
import { ExplorerMap } from "@/components/explorer-map";
import { SearchPanel } from "@/views/search-panel";
import { FlightResults } from "@/views/flight-results";
import type { NetworkModel } from "@/static/adapter";
import { DEFAULT_SETTINGS, EMPTY_QUERY, flightResults, LAST_SEARCH_KEY, readSettings, searchUrl } from "@/static/search";
import type { FareQuery, StaticCatalog, StoredFlight } from "@/static/types";

export function HomeView({ catalog, network, initial }: { catalog: StaticCatalog; network: NetworkModel; initial: FareQuery | null }) {
  const mode = useContext(LinkModeContext);
  const [query, setQuery] = useState<FareQuery | null>(initial);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [focusAirport, setFocusAirport] = useState<string | null>(initial?.origin ?? null);
  const [selectedFlight, setSelectedFlight] = useState<StoredFlight | null>(null);
  const [mobileView, setMobileView] = useState<"results" | "map">(initial?.date ? "results" : "map");
  useEffect(() => { queueMicrotask(() => setSettings(readSettings())); }, []);
  useEffect(() => {
    if (!initial) return;
    try { window.sessionStorage.setItem(LAST_SEARCH_KEY, searchUrl(initial)); } catch { /* Storage is optional. */ }
    window.dispatchEvent(new Event("frontier-search"));
  }, [initial]);
  const options = useMemo(() => query?.destination && query.date ? flightResults(catalog, query).flights : [], [catalog, query]);
  const flight = selectedFlight && options.some((option) => option.id === selectedFlight.id) ? selectedFlight : options[0] ?? null;
  const selectedAirports = flight ? [flight.origin, ...(flight.segments ?? []).map((segment) => segment.destination)] : query?.destination ? [query.origin, query.destination] : [];
  function search(next: FareQuery) {
    setQuery(next); setSelectedFlight(null); setFocusAirport(next.origin); setMobileView("results");
    const url = searchUrl(next);
    try { window.sessionStorage.setItem(LAST_SEARCH_KEY, url); } catch { /* Search also works without browser storage. */ }
    const target = mode === "hash" ? `#${url}` : url;
    window.history.pushState(null, "", target);
    window.dispatchEvent(new Event("popstate"));
    window.dispatchEvent(new Event("frontier-search"));
  }
  function airportClick(code: string) { search({ ...EMPTY_QUERY, origin: code, maxStops: settings.maxStops, excludeRedEyes: settings.excludeRedEyes }); setMobileView("map"); }
  return <div className="flex flex-col gap-3">
    <SearchPanel key={`${JSON.stringify(query)}|${JSON.stringify(settings)}`} catalog={catalog} initial={query} settings={settings} onFromChange={setFocusAirport} onSearch={search} />
    <div className="flex rounded border border-[#24302a] p-1 text-sm lg:hidden" aria-label="Search view"><button type="button" aria-pressed={mobileView === "results"} onClick={() => setMobileView("results")} className={`flex-1 rounded py-2 ${mobileView === "results" ? "bg-[#24302a]" : "text-[#8b9790]"}`}>Results</button><button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")} className={`flex-1 rounded py-2 ${mobileView === "map" ? "bg-[#24302a]" : "text-[#8b9790]"}`}>Map</button></div>
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section aria-label="Flight results" className={`${mobileView === "results" ? "block" : "hidden"} min-w-0 rounded-lg border border-[#24302a] bg-[#090b0d] lg:block lg:max-h-[calc(100dvh-16rem)] lg:overflow-auto`}>
        <FlightResults catalog={catalog} query={query} settings={settings} selectedId={flight?.id ?? null} onSelect={(next) => { setSelectedFlight(next); setMobileView("map"); }} onSearch={search} />
      </section>
      <div className={`${mobileView === "map" ? "block" : "hidden"} h-[max(24rem,calc(100dvh-22rem))] min-w-0 lg:block lg:h-[calc(100dvh-16rem)] lg:min-h-[20rem]`}>
        <ExplorerMap tileStyle={network.tileStyle} routes={network.routes} airports={network.airports} interest={network.interest} focusAirport={focusAirport} selected={query?.destination ? { origin: query.origin, destination: query.destination } : null} selectedPath={selectedAirports} onAirportClick={airportClick} onRouteClick={(origin, destination) => search({ ...EMPTY_QUERY, origin, destination, date: query?.date || "", maxStops: settings.maxStops })} />
      </div>
    </div>
  </div>;
}
