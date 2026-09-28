import { AppLink } from "@/components/app-link";
import { clock, fareText, formatChecked, formatDay, formatElapsed, legacyPartialGoWild, storedGoWild, type GoWildFare } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function GoWildView({ catalog }: { catalog: StaticCatalog }) {
  const rows = storedGoWild(catalog);
  const legacy = legacyPartialGoWild(catalog);
  const cheapest = [...rows].sort((a, b) => a.goWild.total - b.goWild.total)[0] ?? null;
  const recent: string[] = [];
  for (const row of [...rows].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))) {
    const label = `${row.origin} → ${row.destination}`;
    if (!recent.includes(label)) recent.push(label);
    if (recent.length === 3) break;
  }
  const routes = new Set(rows.map((row) => `${row.origin} → ${row.destination}`));
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-medium">GoWild</h1>
        <p className="text-sm text-[#8b9790]">GoWild prices come only from fare checks. A route without a GoWild fare is omitted. This is not an availability promise. Seats are not shown.</p>
      </header>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded border border-[#24302a] p-3"><dt className="text-[#8b9790]">Routes with GoWild</dt><dd className="font-mono text-lg">{routes.size}</dd></div>
        <div className="rounded border border-[#24302a] p-3"><dt className="text-[#8b9790]">Cheapest observed</dt><dd className="font-mono">{cheapest ? `${cheapest.origin} → ${cheapest.destination} ${fareText(cheapest.goWild)}` : "—"}</dd></div>
        <div className="rounded border border-[#24302a] p-3"><dt className="text-[#8b9790]">Recently observed</dt><dd className="font-mono">{recent.join(", ") || "—"}</dd></div>
      </dl>
      {rows.length === 0 ? (
        <p className="text-sm text-[#8b9790]">No GoWild fare on these flights.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.itineraryId} className="rounded border border-[#24302a] p-3 text-sm">
              <ItineraryRow row={row} />
            </li>
          ))}
        </ul>
      )}
      {legacy.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Legacy partial fare observation</h2>
          <p className="text-sm text-[#8b9790]">The full path was not retained. These are not bookable trips.</p>
          <ul className="space-y-3">
            {legacy.map((row) => (
              <li key={row.itineraryId} className="rounded border border-dashed border-[#24302a] p-3 text-sm">
                <p className="font-medium">
                  {row.origin} → {row.destination}
                </p>
                <p className="mt-1">{formatDay(row.date)}</p>
                <p className="mt-1 text-[#8b9790]">Legacy partial fare observation. The full path was not retained.</p>
                <div className="mt-1 font-mono">GoWild {fareText(row.goWild)}</div>
                <p className="mt-1 text-xs text-[#8b9790]">Fares checked {formatChecked(row.checkedAt)}. Source: Frontier.</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function ItineraryRow({ row }: { row: GoWildFare }) {
  const via = row.via.length ? ` via ${row.via.join(", ")}` : "";
  const flights = row.segments.map((segment) => `F9 ${segment.flightNumber}`).join(" + ");
  return (
    <>
      <AppLink href={`/routes/${row.origin}/${row.destination}`} className="font-medium hover:text-[#3dbe7a]">
        {row.origin} → {row.destination}
      </AppLink>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-[#8b9790]">{row.stops === 0 ? "Nonstop" : `${row.stops} stop`}</div>
      {row.stops === 0 ? (
        <div className="mt-1">
          F9 {row.flightNumber} · {formatDay(row.date)} · {clock(row.departureLocal)}–{clock(row.arrivalLocal)}
          {row.durationMinutes ? ` · ${formatElapsed(row.durationMinutes)}` : ""}
        </div>
      ) : (
        <div className="mt-1">
          {row.origin} → {row.destination}, {row.stops} stop{row.stops === 1 ? "" : "s"}
          {via}, {flights}
          <p className="mt-1">
            {row.segments.map((segment) => (
              <span key={`${segment.flightNumber}|${segment.departureLocal}`} className="mr-3">
                F9 {segment.flightNumber} {segment.origin} {clock(segment.departureLocal)}–{segment.destination} {clock(segment.arrivalLocal)}
              </span>
            ))}
            {row.durationMinutes ? `· ${formatElapsed(row.durationMinutes)}` : ""}
          </p>
        </div>
      )}
      <div className="mt-1 font-mono">GoWild {fareText(row.goWild)}</div>
      <p className="mt-1 text-xs text-[#8b9790]">Fares checked {formatChecked(row.checkedAt)}. Source: Frontier.</p>
    </>
  );
}
