import { AppLink } from "@/components/app-link";
import { clock, fareText, formatChecked, formatDay, storedGoWild } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function GoWildView({ catalog }: { catalog: StaticCatalog }) {
  const rows = storedGoWild(catalog);
  const cheapest = [...rows].sort((a, b) => a.goWild.total - b.goWild.total)[0] ?? null;
  const recent = [...rows].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0] ?? null;
  const routes = new Set(rows.map((row) => `${row.origin} → ${row.destination}`));
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-medium">GoWild</h1>
        <p className="text-sm text-[#8b9790]">GoWild prices come only from fare checks. A route without a GoWild fare is omitted. This is not an availability promise.</p>
      </header>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded border border-[#24302a] p-3"><dt className="text-[#8b9790]">Routes with GoWild</dt><dd className="font-mono text-lg">{routes.size}</dd></div>
        <div className="rounded border border-[#24302a] p-3"><dt className="text-[#8b9790]">Cheapest observed</dt><dd className="font-mono">{cheapest ? `${cheapest.origin} → ${cheapest.destination} ${fareText(cheapest.goWild)}` : "—"}</dd></div>
        <div className="rounded border border-[#24302a] p-3"><dt className="text-[#8b9790]">Recently observed</dt><dd className="font-mono">{recent ? `${recent.origin} → ${recent.destination}` : "—"}</dd></div>
      </dl>
      {rows.length === 0 ? (
        <p className="text-sm text-[#8b9790]">No GoWild fare on these flights.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={`${row.origin}${row.destination}${row.departureLocal}${row.flightNumber}`} className="rounded border border-[#24302a] p-3 text-sm">
              <AppLink href={`/routes/${row.origin}/${row.destination}`} className="font-medium hover:text-[#3dbe7a]">
                {row.origin} → {row.destination}
              </AppLink>
              <div className="mt-1">
                F9 {row.flightNumber} · {formatDay(row.date)} · {clock(row.departureLocal)}–{clock(row.arrivalLocal)}
              </div>
              <div className="mt-1 font-mono">GoWild {fareText(row.goWild)}</div>
              <p className="mt-1 text-xs text-[#8b9790]">Fares checked {formatChecked(row.checkedAt)}. Source: Frontier.</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
