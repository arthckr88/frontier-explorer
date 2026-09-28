import { AppLink } from "@/components/app-link";
import type { StaticCatalog } from "@/static/types";

export function FrequencyView({ catalog }: { catalog: StaticCatalog }) {
  const frequency = catalog.historical?.frequency;
  if (!frequency) return <p className="text-sm text-[#8b9790]">Frequency is not loaded.</p>;
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Frequency</h1>
        <p className="max-w-2xl text-sm">{frequency.current}</p>
        <p className="max-w-2xl text-sm text-[#8b9790]">{frequency.currentNote}</p>
      </header>
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Historical DOT/BTS</h2>
        <p className="max-w-2xl text-sm text-[#8b9790]">
          {frequency.historicalSource}. {frequency.historicalPeriod}. {frequency.historicalNote}
        </p>
        <table className="w-full text-left text-sm">
          <thead className="font-mono text-[11px] uppercase text-[#8b9790]">
            <tr>
              <th>Route</th>
              <th>Departures</th>
              <th>Per week in period</th>
            </tr>
          </thead>
          <tbody>
            {frequency.routes.map((route) => (
              <tr key={`${route.origin}${route.destination}`} className="border-t border-[#24302a]">
                <td className="py-2">
                  <AppLink href={`/routes/${route.origin}/${route.destination}`}>
                    {route.origin} → {route.destination}
                  </AppLink>
                </td>
                <td className="font-mono">{route.departures}</td>
                <td className="font-mono">{route.perWeek}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
