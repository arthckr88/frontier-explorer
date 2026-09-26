import Link from "next/link";
import { readPopularity } from "@/server/queries/read";

export default async function PopularityPage() {
  const data = await readPopularity();
  const period = data.rows[0]?.periodLabel;
  return (
    <section className="space-y-3">
      <header>
        <h1 className="text-2xl font-medium">Most popular</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">Frontier passengers from BTS T-100. This is historical traffic, not live demand, and it is not the same thing as flight frequency.</p>
        {period ? <p className="mt-1 font-mono text-xs text-[#3ec6d4]">{period}</p> : null}
      </header>
      <p className="text-sm text-[#e2a84a]">{data.domesticNote}</p>
      {data.rows.length === 0 ? <p className="text-sm text-[#8b9790]">No passenger observations are stored.</p> : (
        <table className="w-full text-left text-sm">
          <thead className="font-mono text-[11px] uppercase text-[#8b9790]"><tr><th>Route</th><th>Passengers</th><th>Period</th></tr></thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.originIata}${row.destinationIata}`} className="border-t border-[#24302a]">
                <td className="py-2"><Link href={`/routes/${row.originIata}/${row.destinationIata}`}>{row.originIata} → {row.destinationIata}</Link></td>
                <td className="font-mono">{row.value.toLocaleString()}</td>
                <td className="text-[#8b9790]">{row.periodLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
