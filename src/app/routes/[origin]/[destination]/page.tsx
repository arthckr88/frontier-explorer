import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { frontierSearchUrl } from "@/lib/airports/places";
import { endExplanation } from "@/lib/time/copy";
import { readRoute } from "@/server/queries/read";

export default async function RoutePage({ params }: { params: Promise<{ origin: string; destination: string }> }) {
  const { origin, destination } = await params;
  const data = await readRoute(origin, destination);
  if (!data) notFound();
  const route = data.projection;
  const from = origin.toUpperCase();
  const to = destination.toUpperCase();

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8b9790]">Directional route</p>
        <h1 className="text-3xl font-medium tracking-tight">{from} → {to}</h1>
        <p className="mt-1 text-sm text-[#8b9790]">{to} → {from} is a different route.</p>
      </header>
      {data.watch ? (
        <p className="rounded-md border border-[#e2a84a]/40 bg-[#181e24] p-3 text-sm">
          Watched route. {data.watch.note}
        </p>
      ) : null}
      {!route ? (
        <p className="text-sm text-[#8b9790]">
          No observations have been stored for {from} → {to}. A watch note, if present, is not evidence of service or of an end date.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={route.status} />
            <StatusBadge value={route.confidence} />
            <span className="text-sm text-[#8b9790]">{endExplanation(route)}</span>
          </div>
          {data.timing ? <p className="text-lg">{data.timing}</p> : null}
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <Fact label="Scheduled departures/week" value={route.currentFrequencyPerWeek?.toString() ?? "Not from a timetable"} />
            <Fact label="Announced frequency" value={route.announcedFrequencyPerWeek ? `${route.announcedFrequencyPerWeek}/wk` : "None stored"} />
            <Fact label="Days" value={route.scheduleDays.join(", ") || "Unknown"} />
            <Fact label="First observed" value={route.firstSeenAt.slice(0, 10)} />
            <Fact label="Announced start" value={route.announcedStartDate ?? "None"} />
            <Fact label="Last verified" value={route.lastVerifiedAt?.slice(0, 16) ?? "Never"} />
            <Fact label="Schedule horizon" value={route.scheduleHorizon ?? "No schedule loaded"} />
            <Fact label="Last scheduled departure" value={route.lastScheduledDeparture ?? "None loaded"} />
            <Fact label="Suspected end" value={route.suspectedEndDate ?? "Not confirmed"} />
          </dl>
          <section>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Why this confidence</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-[#c5d0c9]">
              {route.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </section>
          {route.disagreements.length > 0 ? (
            <section className="rounded-md border border-[#e07a3d]/50 p-3">
              <h2 className="mb-2 text-sm font-medium">Sources disagree</h2>
              {route.disagreements.map((item) => (
                <div key={item.field} className="text-sm">
                  <div className="font-mono text-[11px] uppercase text-[#8b9790]">{item.field}</div>
                  <ul>
                    {item.values.map((value) => (
                      <li key={`${value.sourceId}${value.value}`}>{value.sourceName}: {value.value}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}
          {route.latestMarketedDeparture ? (
            <p className="text-sm text-[#8b9790]">
              A Frontier flights-from page showed a marketed sample departing {route.latestMarketedDeparture}. That is not a timetable and not seat availability.
            </p>
          ) : null}
        </>
      )}
      <section>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Timeline</h2>
        {data.changes.length === 0 ? <p className="text-sm text-[#8b9790]">No change events yet. History is appended, not overwritten.</p> : (
          <ol className="space-y-3 border-l border-[#24302a] pl-4">
            {data.changes.map((change) => (
              <li key={`${change.detectedAt}${change.type}`}>
                <div className="font-mono text-[11px] text-[#8b9790]">{change.detectedAt.slice(0, 16)} · {change.type}</div>
                <div className="text-sm">{change.summary}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Sources</h2>
        <ul className="space-y-2 text-sm">
          {data.observations.map((observation) => (
            <li key={`${observation.sourceId}${observation.lastRetrievedAt}${observation.kind}`} className="rounded border border-[#24302a] p-2">
              <div className="font-mono text-[11px] text-[#8b9790]">{observation.sourceId} · {observation.kind}</div>
              <div>First stored {observation.retrievedAt.slice(0, 16)} · last seen {observation.lastRetrievedAt.slice(0, 16)}</div>
              {observation.url ? <a className="text-[#3dbe7a]" href={observation.url}>Source</a> : null}
            </li>
          ))}
          {data.announcements.map((item) => (
            <li key={item.title} className="text-sm">{item.title} {item.url ? <a className="text-[#3dbe7a]" href={item.url}>Open</a> : null}</li>
          ))}
        </ul>
      </section>
      <a className="inline-flex rounded border border-[#3dbe7a] px-3 py-2 text-sm" href={frontierSearchUrl(from, to)}>
        Search on Frontier
      </a>
      <p className="text-xs text-[#8b9790]">This does not purchase a ticket and does not use a Frontier login.</p>
      <Link href={`/routes/${to}/${from}`} className="block text-sm text-[#8b9790]">Also inspect {to} → {from}</Link>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#24302a] p-2">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-[#8b9790]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
