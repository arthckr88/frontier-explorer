import { AppLink } from "@/components/app-link";
import { clock, fareText, formatChecked, formatDay, storedGoWild } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function GoWildView({ catalog }: { catalog: StaticCatalog }) {
  const rows = storedGoWild(catalog);
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-medium">GoWild</h1>
        <p className="text-sm text-[#8b9790]">GoWild fares from Frontier. Discount Den is a separate fare. A missing GoWild fare is not shown as a price.</p>
      </header>
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
