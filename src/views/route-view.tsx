import { AppLink } from "@/components/app-link";
import { clock, fareText, formatChecked, formatDay, formatElapsed, staticRouteDetail } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function RouteView({ catalog, origin, destination }: { catalog: StaticCatalog; origin: string; destination: string }) {
  const data = staticRouteDetail(catalog, origin, destination);
  if (!data) return <p className="text-sm text-[#8b9790]">That route is not on this network.</p>;
  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8b9790]">Directional route</p>
        <h1 className="text-3xl font-medium tracking-tight">
          {data.origin} → {data.destination}
        </h1>
        <p className="mt-1 text-sm text-[#8b9790]">
          {data.originCity} to {data.destinationCity}. {data.destination} → {data.origin} is a different route.
        </p>
        <p className="mt-2 text-sm">{data.official ? "Frontier direct route: yes." : "Frontier direct route: no."}</p>
        {data.official && data.sourceUrl ? (
          <p className="text-sm text-[#8b9790]">
            Official source:{" "}
            <a className="text-[#3dbe7a]" href={data.sourceUrl}>
              Frontier flights-from page
            </a>
          </p>
        ) : null}
      </header>
      {!data.hasSchedule ? (
        <p className="text-sm text-[#8b9790]">
          {data.official
            ? "Frontier lists this as a direct route. A dated schedule has not been captured yet."
            : "No Frontier schedule for this route."}
        </p>
      ) : (
        data.schedule.map((day) => (
          <section key={day.date}>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">{formatDay(day.date)}</h2>
            <div className="space-y-2">
              {day.flights.map((flight) => (
                <article key={flight.id} className="rounded border border-[#24302a] p-3 text-sm">
                  <div className="font-medium">
                    F9 {flight.flightNumber} · {clock(flight.departureLocal)}–{clock(flight.arrivalLocal)} · {formatElapsed(flight.durationMinutes)} · Nonstop
                  </div>
                  {flight.standard || flight.discountDen || flight.goWild ? (
                    <>
                      <p className="mt-1 font-mono text-xs text-[#8b9790]">
                        {[
                          flight.standard ? `Standard ${fareText(flight.standard)}` : null,
                          flight.discountDen ? `Discount Den ${fareText(flight.discountDen)}` : null,
                          flight.goWild ? `GoWild ${fareText(flight.goWild)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-1 text-xs text-[#8b9790]">
                        {flight.checkedAt ? `Fares checked ${formatChecked(flight.checkedAt)}. ` : null}Source: Frontier.
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-[#8b9790]">Fare not checked for this date.</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))
      )}
      <section>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Price history</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-[#8b9790]">No price history for this route.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.history.map((row) => (
              <li key={`${row.observedAt}${row.flightNumber}${row.fareType}${row.price}`} className="font-mono text-xs">
                {row.date} · F9 {row.flightNumber} · {row.fareType} {row.price.toFixed(2)} · {formatChecked(row.observedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Changes</h2>
        {data.changes.length === 0 ? (
          <p className="text-sm text-[#8b9790]">No change events for this route.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.changes.map((change) => (
              <li key={change.id}>
                <span className="font-mono text-[11px] uppercase text-[#8b9790]">{change.recordedOn} · {change.type.replaceAll("_", " ")}</span>
                <div>{change.type === "data_blocked" || change.type === "possible_gap" ? "Check notes for this route are on Changes." : change.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AppLink href={`/routes/${data.destination}/${data.origin}`} className="block text-sm text-[#8b9790]">
        Also inspect {data.destination} → {data.origin}
      </AppLink>
    </article>
  );
}
