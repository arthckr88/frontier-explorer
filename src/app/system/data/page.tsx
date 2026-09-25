import { readSystem } from "@/server/queries/read";

export default async function DataPage() {
  const data = await readSystem();
  const latestBySource = new Map<string, (typeof data.runs)[number]>();
  for (const run of data.runs) {
    if (run.sourceId && !latestBySource.has(run.sourceId)) latestBySource.set(run.sourceId, run);
  }
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Data sources</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">
          A failed fetch is recorded and does not erase stored observations. Priority routes every {data.intervals.SYNC_PRIORITY_HOURS}h, schedules every {data.intervals.SYNC_SCHEDULE_HOURS}h, announcements every {data.intervals.SYNC_ANNOUNCEMENTS_HOURS}h, programs and reconciliation every {data.intervals.SYNC_RECONCILE_HOURS}h, BTS every {data.intervals.SYNC_POPULARITY_DAYS} days.
        </p>
      </header>
      <table className="w-full text-left text-sm">
        <thead className="font-mono text-[11px] uppercase text-[#8b9790]">
          <tr><th>Source</th><th>Tier</th><th>Last status</th><th>Records</th><th>When</th><th>Next check</th></tr>
        </thead>
        <tbody>
          {data.sources.map((source) => {
            const run = latestBySource.get(source.id);
            const hours = intervalHours(source.id, data.intervals);
            const next = run ? new Date(run.startedAt.getTime() + hours * 3_600_000).toISOString() : "due now";
            return (
              <tr key={source.id} className="border-t border-[#24302a] align-top">
                <td className="py-2">{source.name}<div className="font-mono text-[11px] text-[#8b9790]">{source.id}</div></td>
                <td>{source.tier}</td>
                <td>{run?.status ?? "never"}<div className="max-w-sm text-xs text-[#8b9790]">{run?.error || run?.detail}</div></td>
                <td className="font-mono">{run?.recordsObserved ?? "—"}</td>
                <td className="font-mono text-xs">{run?.startedAt.toISOString() ?? "—"}</td>
                <td className="font-mono text-xs">{next}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function intervalHours(sourceId: string, env: { SYNC_PRIORITY_HOURS: number; SYNC_SCHEDULE_HOURS: number; SYNC_ANNOUNCEMENTS_HOURS: number; SYNC_PROGRAMS_HOURS: number; SYNC_POPULARITY_DAYS: number; SYNC_RECONCILE_HOURS: number }) {
  if (sourceId === "frontier-route-pages") return env.SYNC_PRIORITY_HOURS;
  if (sourceId === "frontier-schedule") return env.SYNC_SCHEDULE_HOURS;
  if (sourceId === "frontier-newsroom" || sourceId === "airport-press") return env.SYNC_ANNOUNCEMENTS_HOURS;
  if (sourceId === "frontier-programs") return env.SYNC_PROGRAMS_HOURS;
  if (sourceId === "bts-popularity") return env.SYNC_POPULARITY_DAYS * 24;
  return env.SYNC_RECONCILE_HOURS;
}
