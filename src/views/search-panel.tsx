"use client";

import { useState } from "react";
import { AppLink } from "@/components/app-link";
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
  via: "",
  layover: "",
};

const control = "h-7 w-full min-w-0 rounded border border-[#24302a] bg-[#090b0d] px-1 text-xs text-[#e7ece8]";

export function SearchPanel({
  catalog,
  initial,
  onSearch,
  onFromChange,
}: {
  catalog: StaticCatalog;
  initial?: Partial<FareQuery> | null;
  onSearch: (query: FareQuery) => void;
  onFromChange?: (code: string) => void;
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
  const [via, setVia] = useState(initial?.via ?? "");
  const [layover, setLayover] = useState<FareQuery["layover"]>(initial?.layover ?? "");
  const airports = [...catalog.airports].sort((a, b) => a.iata.localeCompare(b.iata));
  const activeQuery = initial?.origin && initial.destination && initial.date ? ({ ...EMPTY, ...initial } as FareQuery) : null;

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
      via,
      layover,
    });
  }

  return (
    <>
      <form className="grid shrink-0 grid-cols-2 gap-1 rounded-[10px] border border-[#24302a] bg-[#090b0d]/95 p-1.5 lg:flex lg:flex-nowrap lg:items-end lg:gap-1 lg:overflow-x-auto" onSubmit={submit}>
        <Field label="From" className="lg:w-[4.6rem] lg:shrink-0">
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
            list="frontier-airports"
            value={from}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setFrom(next);
              onFromChange?.(next);
            }}
            placeholder="DEN"
            aria-label="From"
            className={`${control} uppercase`}
          />
        </Field>
        <Field label="To" className="lg:w-[4.6rem] lg:shrink-0">
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
            list="frontier-airports"
            value={to}
            onChange={(event) => setTo(event.target.value.toUpperCase())}
            placeholder="MCO"
            aria-label="To"
            className={`${control} uppercase`}
          />
        </Field>
        <Field label="Date" className="lg:w-[8.6rem] lg:shrink-0">
          <input name="date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} aria-label="Date" className={control} />
        </Field>
        <Field label="Stops" className="lg:w-[6.4rem] lg:shrink-0">
          <select aria-label="Stops" value={maxStops} onChange={(event) => setMaxStops(Number(event.target.value))} className={control}>
            <option value={0}>Nonstop only</option>
            <option value={1}>Up to 1 stop</option>
            <option value={2}>Up to 2 stops</option>
          </select>
        </Field>
        <Field label="Duration" className="lg:w-[6.6rem] lg:shrink-0">
          <select aria-label="Duration" value={maxDuration ?? ""} onChange={(event) => setMaxDuration(event.target.value ? Number(event.target.value) : null)} className={control}>
            <option value="">Any</option>
            <option value={300}>Under 5 hours</option>
            <option value={480}>Under 8 hours</option>
            <option value={720}>Under 12 hours</option>
          </select>
        </Field>
        <Field label="Departure" className="lg:w-[7rem] lg:shrink-0">
          <select aria-label="Departure time" value={depart} onChange={(event) => setDepart(event.target.value as FareQuery["depart"])} className={control}>
            <option value="">Any</option>
            <option value="morning">Morning (5 AM–12 PM)</option>
            <option value="afternoon">Afternoon (12–5 PM)</option>
            <option value="evening">Evening (5–10 PM)</option>
          </select>
        </Field>
        <Field label="Arrival" className="lg:w-[7rem] lg:shrink-0">
          <select aria-label="Arrival time" value={arrive} onChange={(event) => setArrive(event.target.value as FareQuery["arrive"])} className={control}>
            <option value="">Any</option>
            <option value="morning">Morning (5 AM–12 PM)</option>
            <option value="afternoon">Afternoon (12–5 PM)</option>
            <option value="evening">Evening (5–10 PM)</option>
          </select>
        </Field>
        <Field label="Layover" className="lg:w-[6.4rem] lg:shrink-0">
          <select aria-label="Layover" value={layover} onChange={(event) => setLayover(event.target.value as FareQuery["layover"])} className={control}>
            <option value="">Any</option>
            <option value="short">Short (60–90 min)</option>
            <option value="normal">Normal (75–180 min)</option>
            <option value="long">Long (2 hours or more)</option>
          </select>
        </Field>
        <Field label="Connecting airport" className="lg:w-[7.2rem] lg:shrink-0">
          <input
            aria-label="Connecting airport"
            list="frontier-airports"
            maxLength={3}
            value={via}
            onChange={(event) => setVia(event.target.value.toUpperCase())}
            placeholder="Any"
            className={`${control} uppercase`}
          />
        </Field>
        <Field label="Sort" className="lg:w-[6.6rem] lg:shrink-0">
          <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as FareQuery["sort"])} className={control}>
            <option value="stops">Fewest stops</option>
            <option value="duration">Shortest trip</option>
            <option value="depart">Earliest departure</option>
          </select>
        </Field>
        <label className="col-span-2 flex h-7 items-center gap-1 text-[11px] text-[#8b9790] lg:w-auto lg:shrink-0">
          <input name="redeye" type="checkbox" role="switch" checked={excludeRedEyes} onChange={(event) => setExcludeRedEyes(event.target.checked)} />
          Exclude red-eyes
        </label>
        <button className="col-span-2 h-7 rounded bg-[#3dbe7a] px-2 text-xs font-medium text-[#090b0d] lg:w-auto lg:shrink-0" type="submit">
          Search
        </button>
        <datalist id="frontier-airports">
          {airports.map((airport) => (
            <option key={airport.iata} value={airport.iata}>
              {airport.city}
            </option>
          ))}
        </datalist>
      </form>
      {activeQuery ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 max-h-[42%] overflow-auto px-1 pb-1">
          <div className="pointer-events-auto">
            <ResultList catalog={catalog} query={activeQuery} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function ResultList({ catalog, query }: { catalog: StaticCatalog; query: FareQuery }) {
  const result = staticFareLookup(catalog, query);
  return (
    <div id="results" className="space-y-1">
      {result.message ? <p className="rounded border border-[#24302a] bg-[#12161b]/95 px-2 py-1 text-xs text-[#8b9790]">{result.message}</p> : null}
      {result.officialNonstop && result.flights.length === 0 ? (
        <p className="rounded border border-[#24302a] bg-[#12161b]/95 px-2 py-1 text-xs">
          <AppLink className="text-[#3dbe7a]" href={`/routes/${query.origin}/${query.destination}`}>
            Open {query.origin} → {query.destination}
          </AppLink>
        </p>
      ) : null}
      {result.flights.map((flight) => (
        <FlightCard key={flight.id} flight={flight} />
      ))}
      {result.paths.map((path) => (
        <p key={path.airports.join("-")} className="rounded border border-[#24302a] bg-[#12161b]/95 px-2 py-1 text-xs">
          {path.airports.join(" → ")} · {path.stops} stop{path.stops === 1 ? "" : "s"} · {path.kind === "timed" ? path.label : "Possible network path"}
        </p>
      ))}
    </div>
  );
}

function FlightCard({ flight }: { flight: StoredFlight }) {
  const stops = flight.stops === 0 ? "Nonstop" : `${flight.stops} stop${flight.stops === 1 ? "" : "s"}`;
  const priced = pricedFares(flight);
  const checked = formatChecked(flight.checkedAt);
  const segments = flight.segments ?? [];
  const via = segments.slice(0, -1).map((segment) => segment.destination);
  if (flight.legacyPartial) {
    return (
      <article className="rounded border border-dashed border-[#24302a] bg-[#12161b]/95 px-2 py-1.5" data-date={flight.date}>
        <p className="text-xs font-medium">
          {flight.origin} → {flight.destination}
        </p>
        <p className="text-[11px] text-[#8b9790]">Legacy partial fare observation. The full path was not retained.</p>
        {priced.length === 0 ? (
          <p className="text-[11px] text-[#8b9790]">Fare not checked for this date.</p>
        ) : (
          <>
            <dl className="mt-1 grid grid-cols-3 gap-1 text-xs">
              {priced.map((item) => (
                <Fare key={item.label} label={item.label} value={fareText(item.fare)} />
              ))}
            </dl>
            <p className="mt-1 text-[11px] text-[#8b9790]">{checked ? `Fares checked ${checked}. ` : null}Source: Frontier.</p>
          </>
        )}
      </article>
    );
  }
  return (
    <article className="rounded border border-[#24302a] bg-[#12161b]/95 px-2 py-1.5" data-flight={flight.flightNumber} data-date={flight.date}>
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="rounded bg-[#181e24] px-1.5 py-0.5 font-medium">{segments.length > 1 ? segments.map((segment) => `F9 ${segment.flightNumber}`).join(" + ") : `F9 ${flight.flightNumber}`}</span>
        <span className="rounded bg-[#181e24] px-1.5 py-0.5">{stops}</span>
        <span className="text-[#8b9790]">{formatElapsed(flight.durationMinutes)}</span>
      </div>
      <div className="text-xs font-medium">
        {flight.stops === 0 ? (
          <>
            {flight.origin} {clock(flight.departureLocal)} → {flight.destination} {clock(flight.arrivalLocal)}
          </>
        ) : (
          <>
            {flight.origin} → {flight.destination}, {flight.stops} stop{flight.stops === 1 ? "" : "s"}
            {via.length ? ` via ${via.join(", ")}` : ""}, {segments.map((segment) => `F9 ${segment.flightNumber}`).join(" + ")}
          </>
        )}
      </div>
      {segments.length > 1 ? (
        <p className="text-[11px] text-[#8b9790]">
          {segments.map((segment) => `F9 ${segment.flightNumber} ${clock(segment.departureLocal)}–${clock(segment.arrivalLocal)}`).join(" · ")}
        </p>
      ) : null}
      {priced.length === 0 ? (
        <p className="text-[11px] text-[#8b9790]">Fare not checked for this date.</p>
      ) : (
        <>
          <dl className="mt-1 grid grid-cols-3 gap-1 text-xs">
            {priced.map((item) => (
              <Fare key={item.label} label={item.label} value={fareText(item.fare)} />
            ))}
          </dl>
          <p className="mt-1 text-[11px] text-[#8b9790]">{checked ? `Fares checked ${checked}. ` : null}Source: Frontier.</p>
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
    <div className="rounded border border-[#24302a] px-1.5 py-0.5">
      <dt className="font-mono text-[9px] uppercase tracking-wide text-[#8b9790]">{label}</dt>
      <dd className="font-mono text-[11px]">
        <div>{frontier}</div>
        {exact ? <div className="text-[10px] text-[#8b9790]">{exact}</div> : null}
      </dd>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`grid min-w-0 gap-0.5 ${className}`}>
      <span className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[#8b9790]">{label}</span>
      {children}
    </label>
  );
}
