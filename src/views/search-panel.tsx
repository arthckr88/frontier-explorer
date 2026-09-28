"use client";

import { useState } from "react";
import { calendarToday, clock, fareText, formatChecked, formatElapsed, staticFareLookup } from "@/static/adapter";
import type { FareQuery, StaticCatalog, StoredFlight } from "@/static/types";

const EMPTY: FareQuery = {
  origin: "",
  destination: "",
  date: "",
  maxStops: 0,
  maxDuration: null,
  depart: "",
  arrive: "",
  sort: "stops",
  excludeRedEyes: true,
};

export function SearchPanel({
  catalog,
  initial,
  onSearch,
}: {
  catalog: StaticCatalog;
  initial?: Partial<FareQuery> | null;
  onSearch: (query: FareQuery) => void;
}) {
  const [from, setFrom] = useState(initial?.origin ?? "");
  const [to, setTo] = useState(initial?.destination ?? "");
  const [date, setDate] = useState(initial?.date || calendarToday());
  const [maxStops, setMaxStops] = useState(initial?.maxStops ?? 0);
  const [maxDuration, setMaxDuration] = useState(initial?.maxDuration ?? null);
  const [depart, setDepart] = useState<FareQuery["depart"]>(initial?.depart ?? "");
  const [arrive, setArrive] = useState<FareQuery["arrive"]>(initial?.arrive ?? "");
  const [sort, setSort] = useState<FareQuery["sort"]>(initial?.sort ?? "stops");
  const [excludeRedEyes, setExcludeRedEyes] = useState(initial?.excludeRedEyes ?? true);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSearch({
      ...EMPTY,
      origin: from.trim().toUpperCase(),
      destination: to.trim().toUpperCase(),
      date,
      maxStops,
      maxDuration,
      depart,
      arrive,
      sort,
      excludeRedEyes,
    });
  }

  return (
    <section className="mx-auto max-w-3xl space-y-3 sm:space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium">Search Frontier</h1>
        <p className="text-sm text-[#8b9790]">One origin, one destination, one date.</p>
      </header>
      <form className="grid gap-2 sm:gap-3" onSubmit={submit}>
        <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          <Field label="From">
            <input
              name="from"
              required
              minLength={3}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              value={from}
              onChange={(event) => setFrom(event.target.value.toUpperCase())}
              placeholder="OAK"
              aria-label="From"
              className="w-full rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-3 text-base uppercase"
            />
          </Field>
          <Field label="To">
            <input
              name="to"
              required
              minLength={3}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              value={to}
              onChange={(event) => setTo(event.target.value.toUpperCase())}
              placeholder="LAS"
              aria-label="To"
              className="w-full rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-3 text-base uppercase"
            />
          </Field>
          <Field label="Date">
            <input
              name="date"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Date"
              className="w-full rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-3 text-base"
            />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          <Field label="Stops">
            <select aria-label="Stops" value={maxStops} onChange={(event) => setMaxStops(Number(event.target.value))} className={selectClass}>
              <option value={0}>Nonstop only</option>
              <option value={1}>Up to 1 stop</option>
              <option value={2}>Up to 2 stops</option>
            </select>
          </Field>
          <Field label="Duration">
            <select
              aria-label="Duration"
              value={maxDuration ?? ""}
              onChange={(event) => setMaxDuration(event.target.value ? Number(event.target.value) : null)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value={300}>Under 5 hours</option>
              <option value={480}>Under 8 hours</option>
              <option value={720}>Under 12 hours</option>
            </select>
          </Field>
          <Field label="Departure">
            <select aria-label="Departure time" value={depart} onChange={(event) => setDepart(event.target.value as FareQuery["depart"])} className={selectClass}>
              <option value="">Any</option>
              <option value="morning">Morning (5 AM–12 PM)</option>
              <option value="afternoon">Afternoon (12–5 PM)</option>
              <option value="evening">Evening (5–10 PM)</option>
            </select>
          </Field>
          <Field label="Arrival">
            <select aria-label="Arrival time" value={arrive} onChange={(event) => setArrive(event.target.value as FareQuery["arrive"])} className={selectClass}>
              <option value="">Any</option>
              <option value="morning">Morning (5 AM–12 PM)</option>
              <option value="afternoon">Afternoon (12–5 PM)</option>
              <option value="evening">Evening (5–10 PM)</option>
            </select>
          </Field>
          <Field label="Sort">
            <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as FareQuery["sort"])} className={selectClass}>
              <option value="stops">Fewest stops</option>
              <option value="duration">Shortest trip</option>
              <option value="depart">Earliest departure</option>
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-3 text-sm text-[#8b9790]">
            <input type="checkbox" checked={excludeRedEyes} onChange={(event) => setExcludeRedEyes(event.target.checked)} />
            Exclude red-eyes
          </label>
        </div>
        <button className="rounded-md bg-[#3dbe7a] px-4 py-3 text-base font-medium text-[#090b0d]" type="submit">
          Search
        </button>
      </form>
      <ResultList catalog={catalog} query={initial?.origin && initial.destination && initial.date ? ({ ...EMPTY, ...initial } as FareQuery) : null} />
    </section>
  );
}

function ResultList({ catalog, query }: { catalog: StaticCatalog; query: FareQuery | null }) {
  if (!query) return null;
  const result = staticFareLookup(catalog, query);
  return (
    <div id="results" className="space-y-3">
      {result.message ? <p className="rounded-md border border-[#e2a84a]/40 bg-[#181e24] px-3 py-3 text-sm">{result.message}</p> : null}
      {result.flights.map((flight) => (
        <FlightCard key={flight.id} flight={flight} />
      ))}
    </div>
  );
}

function FlightCard({ flight }: { flight: StoredFlight }) {
  const stops = flight.stops === 0 ? "Nonstop" : `${flight.stops} stop${flight.stops === 1 ? "" : "s"}`;
  const priced = pricedFares(flight);
  const checked = formatChecked(flight.checkedAt);
  return (
    <article className="rounded-md border border-[#24302a] bg-[#12161b] p-3" data-flight={flight.flightNumber} data-date={flight.date}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-[#181e24] px-2 py-1 font-medium">F9 {flight.flightNumber}</span>
        <span className="rounded bg-[#181e24] px-2 py-1">{stops}</span>
        <span className="text-[#8b9790]">{formatElapsed(flight.durationMinutes)}</span>
      </div>
      <div className="text-base font-medium">
        {flight.origin} {clock(flight.departureLocal)} → {flight.destination} {clock(flight.arrivalLocal)}
      </div>
      {priced.length === 0 ? (
        <p className="mt-3 text-sm text-[#8b9790]">Fare not checked for this date.</p>
      ) : (
        <>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            {priced.map((item) => (
              <Fare key={item.label} label={item.label} value={fareText(item.fare)} />
            ))}
          </dl>
          <p className="mt-3 text-sm text-[#8b9790]">
            {checked ? `Fares checked ${checked}. ` : null}Source: Frontier.
          </p>
        </>
      )}
    </article>
  );
}

function pricedFares(flight: StoredFlight) {
  return [
    flight.standard ? { label: "Standard", fare: flight.standard } : null,
    flight.discountDen ? { label: "Discount Den", fare: flight.discountDen } : null,
    flight.goWild ? { label: "GoWild", fare: flight.goWild } : null,
  ].filter((item): item is { label: string; fare: NonNullable<StoredFlight["standard"]> } => Boolean(item));
}

function Fare({ label, value }: { label: string; value: string }) {
  const [frontier, exact] = value.split(" · ");
  return (
    <div className="rounded border border-[#24302a] px-2 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-[#8b9790]">{label}</dt>
      <dd className="font-mono">
        <div>{frontier}</div>
        {exact ? <div className="text-xs text-[#8b9790]">{exact}</div> : null}
      </dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">{label}</span>
      {children}
    </label>
  );
}

const selectClass = "w-full rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-3 text-base";
