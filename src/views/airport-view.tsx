import { AppLink } from "@/components/app-link";
import { staticAirportDetail } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

export function AirportView({ catalog, iata }: { catalog: StaticCatalog; iata: string }) {
  const data = staticAirportDetail(catalog, iata);
  if (!data) return <p className="text-sm text-[#8b9790]">That airport is not on this network.</p>;
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="font-mono text-xs text-[#3dbe7a]">{data.airport.iata}</p>
        <h1 className="text-3xl font-medium">{data.airport.name}</h1>
        <p className="text-[#8b9790]">
          {data.airport.city} · {data.airport.timezone ?? "timezone unavailable"} · {(data.airport.region || "").replaceAll("_", " ")}
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded border border-[#24302a] p-2">
          <dt className="text-[#8b9790]">Nonstop destinations</dt>
          <dd className="font-mono text-xl">{data.outbound.length}</dd>
        </div>
        <div className="rounded border border-[#24302a] p-2">
          <dt className="text-[#8b9790]">Coordinates</dt>
          <dd className="font-mono text-xs">
            {data.airport.lat}, {data.airport.lon}
          </dd>
        </div>
      </dl>
      {data.outbound.length === 0 ? (
        <p className="text-sm text-[#8b9790]">No Frontier departures from this airport.</p>
      ) : (
        <ul className="divide-y divide-[#24302a] border-y border-[#24302a]">
          {data.outbound.map((route) => (
            <li key={`${route.origin}${route.destination}`}>
              <AppLink href={`/routes/${route.origin}/${route.destination}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-[#3dbe7a]">
                <span>
                  {route.origin} → {route.destination}
                </span>
                <span className="font-mono text-[#8b9790]">{route.next ?? "Nonstop"}</span>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
