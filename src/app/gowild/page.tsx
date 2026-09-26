import Link from "next/link";
import { readPrograms, readPreferences } from "@/server/queries/read";

export default async function GoWildPage() {
  const [rules, preferences] = await Promise.all([readPrograms(), readPreferences()]);
  const gowild = rules.filter((rule) => rule.program === "gowild");
  const den = rules.filter((rule) => rule.program === "discount_den");
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-medium">GoWild and Discount Den</h1>
        <p className="text-sm text-[#8b9790]">
          Fare mode is {preferences.fareMode}. Discount Den is not stacked on a GoWild fare. Seat availability is a separate fact from the route existing.
        </p>
      </header>
      <Callout title="Availability must be confirmed with Frontier.">
        A route existing, a flight being scheduled, and a GoWild booking window being open do not mean a GoWild seat is available. This app does not retrieve live GoWild inventory.
      </Callout>
      <RuleList title="GoWild rules retrieved from Frontier" rules={gowild} empty="GoWild pages have not been parsed yet. Run npm run sync:programs. Rules are not invented when the fetch fails." />
      <RuleList title="Discount Den" rules={den} empty="No Discount Den sentences have been stored." />
      <div>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">From OAK and SFO</h2>
        <p className="text-sm text-[#8b9790]">Bookable-soon lists need scheduled departures. Without a timetable, this page will not guess which flights are inside the GoWild window.</p>
        <div className="mt-2 flex gap-2 text-sm">
          <Link href="/airports/OAK">OAK</Link>
          <Link href="/airports/SFO">SFO</Link>
        </div>
      </div>
    </section>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-md border border-[#e2a84a]/40 p-3 text-sm"><strong>{title}</strong><p className="mt-1 text-[#c5d0c9]">{children}</p></div>;
}

function RuleList({
  title,
  rules,
  empty,
}: {
  title: string;
  rules: { ruleKey: string; summary: string; sourceUrl: string | null; retrievedAt: Date; effectiveDate: string | null }[];
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">{title}</h2>
      {rules.length === 0 ? <p className="text-sm text-[#8b9790]">{empty}</p> : (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <li key={rule.ruleKey} className="rounded border border-[#24302a] p-3 text-sm">
              <div className="font-mono text-[11px] uppercase text-[#8b9790]">{rule.ruleKey}</div>
              <p>{rule.summary}</p>
              <p className="mt-1 text-xs text-[#8b9790]">
                Retrieved {rule.retrievedAt.toISOString()}
                {rule.effectiveDate ? ` · effective ${rule.effectiveDate}` : " · effective date not stated"}
                {rule.sourceUrl ? <> · <a className="text-[#3dbe7a]" href={rule.sourceUrl}>source</a></> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
