"use client";

import { useId, useState } from "react";
import { calendarToday } from "@/static/adapter";
import { DEFAULT_SETTINGS, EMPTY_QUERY, resolveAirport, type SearchSettings } from "@/static/search";
import type { FareQuery, StaticCatalog } from "@/static/types";

const control = "h-10 w-full min-w-0 rounded-md border border-[#304037] bg-[#090b0d] px-2.5 text-sm text-[#e7ece8] focus:border-[#3dbe7a] focus:outline-none focus:ring-1 focus:ring-[#3dbe7a]";

export function SearchPanel({ catalog, initial, onSearch, onFromChange, settings = DEFAULT_SETTINGS }: {
  catalog: StaticCatalog; initial?: Partial<FareQuery> | null; onSearch: (query: FareQuery) => void;
  onFromChange?: (code: string) => void; settings?: SearchSettings;
}) {
  const [draft, setDraft] = useState<FareQuery>({ ...EMPTY_QUERY, maxStops: settings.maxStops, excludeRedEyes: settings.excludeRedEyes, ...initial, date: initial?.date || calendarToday() });
  const [mode, setMode] = useState(initial && !initial.date ? "explore" : "flights");
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const activeFilters = Number(draft.maxDuration != null) + Number(Boolean(draft.depart)) + Number(Boolean(draft.arrive)) + Number(Boolean(draft.via)) + Number(Boolean(draft.layover)) + Number(draft.excludeRedEyes);
  function change<T extends keyof FareQuery>(key: T, value: FareQuery[T]) { setDraft((current) => ({ ...current, [key]: value })); setError(""); }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const origin = resolveAirport(catalog, draft.origin);
    const destination = draft.destination.trim() ? resolveAirport(catalog, draft.destination) : "";
    const via = draft.via?.trim() ? resolveAirport(catalog, draft.via) : "";
    if (!origin || (draft.destination.trim() && !destination) || (draft.via?.trim() && !via)) { setError("Choose an airport from the suggestions."); return; }
    if (origin === destination) { setError("Choose two different airports."); return; }
    if (mode === "flights" && !destination) { setError("Choose a destination, or use Explore routes to see where you can fly."); return; }
    onSearch({ ...draft, origin, destination, via, date: mode === "flights" ? draft.date : "" });
    setAdvanced(false);
  }
  return (
    <form className="relative z-20 shrink-0 rounded-lg border border-[#24302a] bg-[#12161b] p-3" onSubmit={submit}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1 text-xs" aria-label="Search mode">
          <button type="button" aria-pressed={mode === "flights"} onClick={() => setMode("flights")} className={`rounded px-3 py-1.5 ${mode === "flights" ? "bg-[#24302a] text-[#e7ece8]" : "text-[#8b9790]"}`}>Find flights</button>
          <button type="button" aria-pressed={mode === "explore"} onClick={() => setMode("explore")} className={`rounded px-3 py-1.5 ${mode === "explore" ? "bg-[#24302a] text-[#e7ece8]" : "text-[#8b9790]"}`}>Explore routes</button>
        </div>
        <button type="button" aria-expanded={advanced} aria-controls="advanced-filters" onClick={() => setAdvanced(!advanced)} className="rounded border border-[#304037] px-2.5 py-1.5 text-xs">Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
      </div>
      <div className="grid grid-cols-[1fr_2.25rem_1fr] items-end gap-2 md:grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)_9rem_8rem_6rem]">
        <AirportInput catalog={catalog} label="From" value={draft.origin} onChange={(value) => { change("origin", value); onFromChange?.(resolveAirport(catalog, value)); }} placeholder="City or airport" />
        <button type="button" aria-label="Swap airports" className="h-10 rounded border border-[#304037] text-lg" onClick={() => { setDraft((current) => ({ ...current, origin: current.destination, destination: current.origin })); onFromChange?.(resolveAirport(catalog, draft.destination)); }}>⇄</button>
        <AirportInput catalog={catalog} label={mode === "flights" ? "To" : "To (optional)"} value={draft.destination} onChange={(value) => change("destination", value)} placeholder={mode === "flights" ? "City or airport" : "Anywhere"} />
        <Field label="Date" className="col-span-2 md:col-span-1">
          <input type="date" aria-label="Date" disabled={mode === "explore"} required={mode === "flights"} value={draft.date} onInput={(event) => change("date", event.currentTarget.value)} className={`${control} disabled:opacity-40`} />
        </Field>
        <Field label="Stops">
          <select aria-label="Stops" value={draft.maxStops} onChange={(event) => change("maxStops", Number(event.target.value))} className={control}><option value={0}>Nonstop</option><option value={1}>Up to 1 stop</option><option value={2}>Up to 2 stops</option></select>
        </Field>
        <button className="col-span-3 h-10 rounded-md bg-[#3dbe7a] px-4 text-sm font-semibold text-[#090b0d] hover:bg-[#62d797] md:col-span-1" type="submit">{mode === "flights" ? "Search" : "Explore"}</button>
      </div>
      {advanced ? <div id="advanced-filters" className="mt-3 grid gap-3 border-t border-[#24302a] pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Total duration"><select aria-label="Duration" value={draft.maxDuration ?? ""} onChange={(event) => change("maxDuration", event.target.value ? Number(event.target.value) : null)} className={control}><option value="">Any duration</option><option value={300}>Under 5 hours</option><option value={480}>Under 8 hours</option><option value={720}>Under 12 hours</option></select></Field>
        <TimeField label="Departure" value={draft.depart} onChange={(value) => change("depart", value)} />
        <TimeField label="Arrival" value={draft.arrive} onChange={(value) => change("arrive", value)} />
        <Field label="Layover"><select aria-label="Layover" value={draft.layover} onChange={(event) => change("layover", event.target.value as FareQuery["layover"])} className={control}><option value="">Any layover</option><option value="short">60–89 minutes</option><option value="normal">75–180 minutes</option><option value="long">2 hours or more</option></select></Field>
        <AirportInput catalog={catalog} label="Connecting airport" value={draft.via || ""} onChange={(value) => change("via", value)} placeholder="Any" />
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={draft.excludeRedEyes} onChange={(event) => change("excludeRedEyes", event.target.checked)} />Exclude red-eyes</label>
        <button type="button" onClick={() => setDraft((current) => ({ ...current, maxDuration: null, depart: "", arrive: "", via: "", layover: "", excludeRedEyes: false }))} className="text-left text-sm text-[#3dbe7a]">Clear filters</button>
      </div> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-[#e2a84a]">{error}</p> : null}
    </form>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: FareQuery["depart"]; onChange: (value: FareQuery["depart"]) => void }) {
  return <Field label={label}><select aria-label={`${label} time`} value={value} onChange={(event) => onChange(event.target.value as FareQuery["depart"])} className={control}><option value="">Any time</option><option value="morning">Morning · 5 AM–noon</option><option value="afternoon">Afternoon · noon–5 PM</option><option value="evening">Evening · 5–10 PM</option></select></Field>;
}

export function AirportInput({ catalog, label, value, onChange, placeholder }: { catalog: StaticCatalog; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const text = value.toLowerCase().trim();
  const preferred = ["OAK", "SFO", "LAS", "DEN", "MCO", "LAX"];
  const options = catalog.airports.filter((airport) => !text || `${airport.iata} ${airport.city} ${airport.name}`.toLowerCase().includes(text)).sort((a, b) => !text ? (preferred.indexOf(a.iata) < 0 ? 99 : preferred.indexOf(a.iata)) - (preferred.indexOf(b.iata) < 0 ? 99 : preferred.indexOf(b.iata)) : Number(b.iata.toLowerCase() === text) - Number(a.iata.toLowerCase() === text)).slice(0, 7);
  function choose(code: string) { onChange(code); setOpen(false); }
  return <Field label={label} className="relative">
    <input aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id} aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(0); }} onKeyDown={(event) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive((current) => options.length ? (current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0); }
      if (event.key === "Enter" && open && options[active]) { event.preventDefault(); choose(options[active]!.iata); }
    }} className={control} />
    {open ? <div id={id} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border border-[#304037] bg-[#12161b] p-1 shadow-xl">
      {options.length ? options.map((airport, index) => <button key={airport.iata} id={`${id}-${index}`} type="button" role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(airport.iata)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${active === index ? "bg-[#24302a]" : "hover:bg-[#181e24]"}`}><span className="font-mono text-[#3dbe7a]">{airport.iata}</span><span className="min-w-0 truncate">{airport.city}<span className="block truncate text-[10px] text-[#8b9790]">{airport.name}</span></span></button>) : <p className="p-2 text-xs text-[#8b9790]">No matching airport. Try a city or airport code.</p>}
    </div> : null}
  </Field>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid min-w-0 gap-1 ${className}`}><span className="text-[11px] font-medium text-[#aab6ae]">{label}</span>{children}</label>;
}
