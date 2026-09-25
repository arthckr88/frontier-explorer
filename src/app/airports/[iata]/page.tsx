import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { readAirport } from "@/server/queries/read";

export default async function AirportPage({ params }: { params: Promise<{ iata: string }> }) {
  const { iata } = await params;
  const data = await readAirport(iata);
  if (!data) notFound();
  const weekly = data.outbound.reduce((sum, route) => sum + (route.currentFrequencyPerWeek ?? 0), 0);
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="font-mono text-xs text-[#3dbe7a]">{data.airport.iata}</p>
        <h1 className="text-3xl font-medium">{data.airport.name}</h1>
        <p className="text-[#8b9790]">{data.airport.city} · {data.airport.timezone ?? "timezone unknown"} · {data.airport.region.replaceAll("_", " ")}</p>
      </header>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded border border-[#24302a] p-2"><dt className="text-[#8b9790]">Observed destinations</dt><dd className="font-mono text-xl">{data.outbound.length}</dd></div>
        <div className="rounded border border-[#24302a] p-2"><dt className="text-[#8b9790]">Scheduled departures/week</dt><dd className="font-mono text-xl">{weekly || "—"}</dd></div>
        <div className="rounded border border-[#24302a] p-2"><dt className="text-[#8b9790]">Coordinates</dt><dd className="font-mono text-xs">{data.airport.latitude ?? "—"}, {data.airport.longitude ?? "—"}</dd></div>
      </dl>
      {data.outbound.length === 0 ? <p className="text-sm text-[#8b9790]">No Frontier route observations start at this airport yet.</p> : (
        <ul className="divide-y divide-[#24302a] border-y border-[#24302a]">
          {data.outbound.map((route) => (
            <li key={`${route.origin}${route.destination}`}>
              <Link href={`/routes/${route.origin}/${route.destination}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-[#3dbe7a]">
                <span>{route.origin} → {route.destination}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge value={route.status} />
                  <span className="font-mono text-[#8b9790]">{route.currentFrequencyPerWeek != null ? `${route.currentFrequencyPerWeek}/wk` : "no timetable"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
