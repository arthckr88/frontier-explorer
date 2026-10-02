"use client";

import { useMemo } from "react";
import { AppLink } from "@/components/app-link";
import { calendarToday, clock, formatChecked, formatDay, formatElapsed, staticDiscover } from "@/static/adapter";
import { dateStatus, EMPTY_QUERY, flightDates, flightResults, frontierSearchUrl, scheduleSourceUrl, suggestedFlights, type SearchSettings } from "@/static/search";
import type { FareQuery, StaticCatalog, StoredFlight } from "@/static/types";

export function FlightResults({ catalog, query, selectedId, onSelect, onSearch, settings }: {
  catalog: StaticCatalog; query: FareQuery | null; selectedId: string | null; onSelect: (flight: StoredFlight) => void;
  onSearch: (query: FareQuery) => void; settings: SearchSettings;
}) {
  const result = useMemo(() => query?.destination && query.date ? flightResults(catalog, query) : null, [catalog, query]);
  const dates = useMemo(() => query?.destination && query.date ? flightDates(catalog, query) : [], [catalog, query]);
  const today = calendarToday();
  if (!query) return <div className="space-y-4 p-4">
    <div><h1 className="text-lg font-medium">Find your next flight</h1><p className="mt-1 text-sm text-[#8b9790]">Search a route and date, or tap an airport on the map to explore destinations.</p></div>
    <div><h2 className="mb-2 text-xs font-medium text-[#aab6ae]">Try a date with flight times</h2><div className="space-y-2">{suggestedFlights(catalog).map((item) => <button type="button" key={`${item.origin}${item.destination}`} onClick={() => onSearch({ ...EMPTY_QUERY, ...item, excludeRedEyes: settings.excludeRedEyes })} className="flex w-full items-center justify-between rounded border border-[#24302a] px-3 py-2.5 text-left text-sm hover:border-[#3dbe7a]"><span>{item.origin} → {item.destination}</span><span className="text-xs text-[#8b9790]">{formatDay(item.date).replace(", 2026", "")}</span></button>)}</div></div>
    <p className="text-xs leading-relaxed text-[#8b9790]">Every route search links to a free Frontier timetable on FlightConnections. Flight times and prices are available for selected dates; searches don’t fetch live availability.</p>
  </div>;
  const from = catalog.airports.find((airport) => airport.iata === query.origin);
  const to = catalog.airports.find((airport) => airport.iata === query.destination);
  if (!query.date || !query.destination) {
    const groups = staticDiscover(catalog, query.origin, query.maxStops).groups;
    return <div className="space-y-4 p-4"><header><h2 className="text-lg font-medium">From {from?.city || query.origin}</h2><p className="text-xs text-[#8b9790]">Explore routes, then choose a destination and date to find flights.</p></header>{groups.map((group) => <section key={group.stop}><h3 className="mb-2 text-xs font-medium text-[#8b9790]">{group.stop === 0 ? "Nonstop destinations" : `Reachable with ${group.stop} stop${group.stop > 1 ? "s" : ""}`}</h3><div className="space-y-1">{group.items.filter((item) => !query.destination || item.iata === query.destination).map((item) => <button type="button" key={item.iata} onClick={() => onSearch({ ...query, destination: item.iata, date: today })} className="flex w-full justify-between rounded border border-[#24302a] px-3 py-2 text-left text-sm hover:border-[#3dbe7a]"><span>{item.city}</span><span className="font-mono text-[#3dbe7a]">{item.iata}</span></button>)}</div></section>)}{query.destination ? <a href={scheduleSourceUrl(query.origin, query.destination)} target="_blank" rel="noopener noreferrer" className="block rounded bg-[#3dbe7a] px-3 py-2 text-center text-sm text-[#090b0d]">Open free route timetable ↗</a> : null}<AppLink href={`/airports/${query.origin}`} className="block text-sm text-[#3dbe7a]">Airport details →</AppLink></div>;
  }
  const flights = result?.flights ?? [];
  const state = dateStatus(catalog, query);
  const legs = [...new Map(flights.flatMap((flight) => flight.segments ?? []).map((leg) => [`${leg.origin}|${leg.destination}`, leg])).values()];
  const upcoming = dates.filter((date) => date >= today);
  const past = dates.filter((date) => date < today);
  const emptyMessage = state === "captured" ? "No complete flights match these filters." : state === "empty" ? "Frontier returned no nonstop flights when this date was checked. Try another date or allow connections." : state === "unavailable" ? "The last flight check could not be completed. Check this date directly with Frontier." : "Flight times haven’t been captured for this route and date. This does not mean Frontier has no flights.";
  return <div id="results" className="space-y-3 p-3" aria-live="polite">
    <header><h2 className="text-lg font-medium">{query.origin} → {query.destination}</h2><p className="text-xs text-[#8b9790]">{from?.city} to {to?.city} · {formatDay(query.date)}</p></header>
    {query.date < today ? <p className="rounded border border-[#e2a84a]/40 bg-[#e2a84a]/5 px-2 py-1.5 text-xs text-[#e2a84a]">Past flight date · prices below are historical.</p> : null}
    <div className="flex items-center justify-between gap-2"><p className="text-xs text-[#aab6ae]">{flights.length} flight option{flights.length === 1 ? "" : "s"}</p><select aria-label="Sort results" value={query.sort} onChange={(event) => onSearch({ ...query, sort: event.target.value as FareQuery["sort"] })} className="min-w-0 rounded border border-[#304037] bg-[#090b0d] px-2 py-1.5 text-xs"><option value="stops">Fewest stops</option><option value="duration">Shortest trip</option><option value="depart">Earliest departure</option></select></div>
    {flights.length === 0 ? <div className="space-y-2 rounded-md border border-[#24302a] p-3 text-sm"><p>{emptyMessage}</p>{result?.officialNonstop ? <p className="text-xs text-[#8b9790]">Frontier lists this as a nonstop route.</p> : null}{state === "captured" ? <button type="button" className="text-[#3dbe7a]" onClick={() => onSearch({ ...EMPTY_QUERY, origin: query.origin, destination: query.destination, date: query.date, maxStops: query.maxStops, excludeRedEyes: false })}>Clear flight filters</button> : null}</div> : null}
    {flights.map((flight) => <FlightCard key={flight.id} flight={flight} selected={selectedId === flight.id} onSelect={() => onSelect(flight)} fareMode={settings.fareMode} />)}
    {upcoming.length ? <div><h3 className="mb-1.5 text-xs text-[#8b9790]">Other dates with matching flight times</h3><div className="flex flex-wrap gap-1.5">{upcoming.slice(0, 12).map((date) => <button type="button" key={date} aria-pressed={date === query.date} onClick={() => onSearch({ ...query, date })} className={`rounded border px-2 py-1.5 text-xs ${date === query.date ? "border-[#3dbe7a] text-[#3dbe7a]" : "border-[#304037]"}`}>{formatDay(date).replace(/, \d{4}$/, "")}</button>)}</div></div> : null}
    {past.length ? <details className="text-xs text-[#8b9790]"><summary className="cursor-pointer py-1">Past dates with flight times</summary><div className="mt-1 flex flex-wrap gap-1.5">{past.map((date) => <button type="button" key={date} onClick={() => onSearch({ ...query, date })} className="rounded border border-[#304037] px-2 py-1.5">{formatDay(date)}</button>)}</div></details> : null}
    {result?.paths.length ? <details className="rounded border border-[#24302a] p-2 text-xs"><summary className="cursor-pointer">Possible network paths ({result.paths.length})</summary><p className="my-2 text-[#8b9790]">These paths have no verified flight times for this date.</p>{result.paths.map((path) => <p className="py-1" key={path.airports.join("-")}>{path.airports.join(" → ")}</p>)}</details> : null}
    {query.maxStops > 0 && legs.length > 1 ? <div className="space-y-1"><p className="text-xs text-[#8b9790]">Free timetables for individual legs</p>{legs.map((leg) => <a key={`${leg.origin}${leg.destination}`} href={scheduleSourceUrl(leg.origin, leg.destination)} target="_blank" rel="noopener noreferrer" className="block rounded border border-[#304037] px-2 py-2 text-xs text-[#3dbe7a]">{leg.origin} → {leg.destination} · Frontier calendar ↗</a>)}</div> : null}
    <a href={scheduleSourceUrl(query.origin, query.destination)} target="_blank" rel="noopener noreferrer" className="block rounded-md bg-[#3dbe7a] px-3 py-2.5 text-center text-sm font-medium text-[#090b0d]">Open free route timetable ↗</a>
    <p className="text-[11px] text-[#8b9790]">FlightConnections · {query.date < today ? "choose a future date" : `choose ${formatDay(query.date)}`} and look for Frontier’s calendar when available. External schedules may differ from the captured results above.</p>
    <a href={frontierSearchUrl()} target="_blank" rel="noopener noreferrer" className="block rounded-md border border-[#3dbe7a]/50 px-3 py-2 text-center text-sm text-[#3dbe7a]">Confirm prices on Frontier ↗</a>
    <p className="text-[11px] leading-relaxed text-[#8b9790]">Local airport times. Flight options use captured schedules; prices apply only to the date shown. Confirm the flight and any connection with Frontier.</p>
  </div>;
}

function FlightCard({ flight, selected, onSelect, fareMode }: { flight: StoredFlight; selected: boolean; onSelect: () => void; fareMode: SearchSettings["fareMode"] }) {
  const segments = flight.segments ?? [];
  const fares = [{ label: "Standard", key: "standard", fare: flight.standard }, { label: "Discount Den", key: "discount_den", fare: flight.discountDen }, { label: "GoWild", key: "gowild", fare: flight.goWild }];
  return <article data-flight={segments.map((segment) => segment.flightNumber).join("+") || flight.flightNumber} data-date={flight.date} className={`rounded-lg border bg-[#12161b] p-3 ${selected ? "border-[#3dbe7a]" : "border-[#24302a]"}`}>
    <button type="button" aria-label={`Show F9 ${segments.map((segment) => segment.flightNumber).join(" + ") || flight.flightNumber} on map`} aria-pressed={selected} onClick={onSelect} className="w-full text-left">
      <div className="flex items-center justify-between gap-1 text-[11px] text-[#8b9790]"><span>{segments.map((segment) => `F9 ${segment.flightNumber}`).join(" + ") || `F9 ${flight.flightNumber}`}</span><span>{flight.stops === 0 ? "Nonstop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`} · {formatElapsed(flight.durationMinutes)}</span></div>
      <div className="mt-1 flex items-center justify-between text-lg font-medium"><span>{clock(flight.departureLocal)}</span><span className="text-xs font-normal text-[#8b9790]">→</span><span>{clock(flight.arrivalLocal)}{flight.arrivalLocal.slice(0, 10) > flight.date ? <sup className="ml-1 text-[10px] text-[#e2a84a]">+{Math.round((Date.parse(flight.arrivalLocal.slice(0, 10)) - Date.parse(flight.date)) / 86400000)} day</sup> : null}</span></div>
      <div className="flex justify-between font-mono text-xs text-[#8b9790]"><span>{flight.origin}</span><span>{flight.destination}</span></div>
    </button>
    {segments.length > 1 ? <div className="mt-2 space-y-1 border-t border-[#24302a] pt-2 text-xs">{segments.map((segment, index) => <div key={`${segment.flightNumber}${segment.departureLocal}`}><p>F9 {segment.flightNumber} · {segment.origin} {clock(segment.departureLocal)} → {segment.destination} {clock(segment.arrivalLocal)}</p>{flight.connections?.[index] ? <p className="py-1 text-[#8b9790]">{formatElapsed(flight.connections[index]!.minutes)} layover in {segment.destination}</p> : null}</div>)}</div> : null}
    {fares.some((item) => item.fare) ? <><dl className="mt-2 grid grid-cols-3 gap-1 border-t border-[#24302a] pt-2">{fares.map((item) => <div key={item.key} className={fareMode === item.key ? "text-[#3dbe7a]" : "text-[#c5d0c9]"}><dt className="text-[10px]">{item.label}</dt><dd className="mt-0.5 font-mono text-sm">{item.fare ? new Intl.NumberFormat("en-US", { style: "currency", currency: item.fare.currency }).format(item.fare.total) : "—"}</dd></div>)}</dl><p className="mt-1.5 text-[10px] text-[#8b9790]">Price checked {formatChecked(flight.checkedAt)}. Source: Frontier.</p></> : <p className="mt-2 border-t border-[#24302a] pt-2 text-xs text-[#8b9790]">Price unavailable for this flight.</p>}
  </article>;
}
