"use client";

import { useState } from "react";
import { AppLink } from "@/components/app-link";
import { clock, staticPlanner } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

const MODULES = {
  "bay-la": { label: "Bay Area → Southern California", origins: ["OAK", "SFO", "SJC"], destinations: ["LAX", "BUR", "ONT", "SNA", "SAN"] },
  "bay-ny": { label: "Bay Area → New York", origins: ["OAK", "SFO", "SJC"], destinations: ["LGA", "EWR", "SWF", "ISP"] },
  florida: { label: "Florida", origins: ["OAK", "SFO", "SJC"], destinations: ["MCO", "TPA", "FLL", "MIA", "RSW"] },
} as const;

export function PlannerView({
  catalog,
  moduleKey,
  date,
}: {
  catalog: StaticCatalog;
  moduleKey: string | null;
  date: string;
}) {
  const selected = moduleKey && moduleKey in MODULES ? MODULES[moduleKey as keyof typeof MODULES] : null;
  const [originsText, setOriginsText] = useState((selected?.origins ?? ["DEN"]).join(", "));
  const [destinationsText, setDestinationsText] = useState((selected?.destinations ?? ["MCO"]).join(", "));
  const [day, setDay] = useState(date);
  const [maxStops, setMaxStops] = useState(1);
  const [excludeRedEyes, setExcludeRedEyes] = useState(true);
  const [submitted, setSubmitted] = useState({
    origins: selected?.origins ? [...selected.origins] : ["DEN"],
    destinations: selected?.destinations ? [...selected.destinations] : ["MCO"],
    date,
    maxStops: 1,
    excludeRedEyes: true,
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted({
      origins: originsText.split(/[^A-Za-z]+/).map((code) => code.toUpperCase()).filter((code) => code.length === 3),
      destinations: destinationsText.split(/[^A-Za-z]+/).map((code) => code.toUpperCase()).filter((code) => code.length === 3),
      date: day,
      maxStops,
      excludeRedEyes,
    });
  }

  const planned = staticPlanner(catalog, submitted);

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Planner</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">
          Timed options use Frontier flights only. A path without times is a chain of nonstops, not a guarantee for this date.
        </p>
      </header>
      <form className="grid gap-2 rounded-md border border-[#24302a] bg-[#12161b] p-3 md:grid-cols-2" onSubmit={submit}>
        <label className="text-sm text-[#8b9790]">
          From
          <input value={originsText} onChange={(event) => setOriginsText(event.target.value)} className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-3 py-2 text-sm text-[#e7ece8]" aria-label="From airports" />
        </label>
        <label className="text-sm text-[#8b9790]">
          To
          <input value={destinationsText} onChange={(event) => setDestinationsText(event.target.value)} className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-3 py-2 text-sm text-[#e7ece8]" aria-label="To airports" />
        </label>
        <label className="text-sm text-[#8b9790]">
          Date
          <input type="date" value={day} onInput={(event) => setDay(event.currentTarget.value)} className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-3 py-2 text-sm text-[#e7ece8]" aria-label="Date" />
        </label>
        <label className="text-sm text-[#8b9790]">
          Stops
          <select value={maxStops} onChange={(event) => setMaxStops(Number(event.target.value))} className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-3 py-2 text-sm text-[#e7ece8]" aria-label="Stops">
            <option value={0}>Nonstop</option>
            <option value={1}>Up to 1 stop</option>
            <option value={2}>Up to 2 stops</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[#8b9790]">
          <input type="checkbox" checked={excludeRedEyes} onChange={(event) => setExcludeRedEyes(event.target.checked)} />
          Exclude red-eyes
        </label>
        <button className="rounded bg-[#3dbe7a] px-3 py-2 text-sm text-[#090b0d]" type="submit">
          Search
        </button>
      </form>
      <div className="flex flex-wrap gap-2 text-sm">
        {Object.entries(MODULES).map(([id, item]) => (
          <AppLink key={id} href={`/planner?module=${id}&date=${day}`} className="rounded border border-[#24302a] px-2 py-1">
            {item.label}
          </AppLink>
        ))}
      </div>
      <p className="font-mono text-xs text-[#8b9790]">
        Using {submitted.origins.join(", ") || "—"} → {submitted.destinations.join(", ") || "—"}
      </p>
      {planned.notice ? <p className="rounded border border-[#e2a84a]/40 p-3 text-sm">{planned.notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Timed options</h2>
          {planned.itineraries.length === 0 ? <p className="text-sm text-[#8b9790]">No timed itinerary matched.</p> : planned.itineraries.slice(0, 12).map((itinerary) => (
            <article key={itinerary.id} className="mb-3 rounded border border-[#24302a] p-3 text-sm">
              <div className="font-mono">
                {itinerary.segments.map((segment) => `${segment.flightNumber ? `F9 ${segment.flightNumber} ` : ""}${segment.origin} ${clock(segment.departureLocal)}→${segment.destination} ${clock(segment.arrivalLocal)}`).join(" · ")}
              </div>
              <p className="mt-1 text-[#8b9790]">{itinerary.stops} stops · {Math.round(itinerary.elapsedMinutes / 60)}h elapsed</p>
            </article>
          ))}
        </div>
        <div>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Paths</h2>
          <p className="mb-2 text-xs text-[#8b9790]">A path without times is a Possible network path, not a dated itinerary.</p>
          {planned.untimed.length === 0 ? <p className="text-sm text-[#8b9790]">No path connects these airports.</p> : planned.untimed.map((path) => (
            <div key={path.airports.join("-")} className="mb-2 font-mono text-xs">{path.airports.join(" → ")}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
