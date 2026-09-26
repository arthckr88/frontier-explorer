import Link from "next/link";
import { readFrequencyRankings } from "@/server/queries/read";

export default async function FrequencyPage() {
  const rows = await readFrequencyRankings();
  return (
    <section className="space-y-3">
      <header>
        <h1 className="text-2xl font-medium">Most frequent</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">Scheduled Frontier departures per week from timetable observations. An announced frequency is not counted here. Trend compares the previous stored frequency.</p>
      </header>
      {rows.length === 0 ? <p className="text-sm text-[#8b9790]">No timetable frequency is loaded. This list stays empty instead of using press-release frequencies.</p> : (
        <table className="w-full text-left text-sm">
          <thead className="font-mono text-[11px] uppercase text-[#8b9790]"><tr><th>Route</th><th>Per week</th><th>Trend</th><th>Days</th></tr></thead>
          <tbody>
            {rows.map((route) => {
              const previous = route.previousFrequencyPerWeek;
              const current = route.currentFrequencyPerWeek ?? 0;
              const trend = previous == null ? "→" : current > previous ? "↑" : current < previous ? "↓" : "→";
              return (
                <tr key={`${route.origin}${route.destination}`} className="border-t border-[#24302a]">
                  <td className="py-2"><Link href={`/routes/${route.origin}/${route.destination}`}>{route.origin} → {route.destination}</Link></td>
                  <td className="font-mono">{current}</td>
                  <td>{trend}</td>
                  <td className="font-mono text-[#8b9790]">{route.scheduleDays.join(" ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
