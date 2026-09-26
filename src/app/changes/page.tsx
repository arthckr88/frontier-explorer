import Link from "next/link";
import { readChanges } from "@/server/queries/read";

const WINDOWS = [
  ["24h", "24h", 1],
  ["7d", "7d", 7],
  ["30d", "30d", 30],
  ["all", "All", null],
] as const;

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const windowKey = WINDOWS.some((item) => item[0] === params.window) ? params.window : "30d";
  const scope = params.scope === "mine" || params.scope === "saved" ? params.scope : "all";
  const selected = WINDOWS.find((item) => item[0] === windowKey) ?? WINDOWS[2];
  const rows = await readChanges(selected[2], scope);
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Route changes</h1>
        <p className="text-sm text-[#8b9790]">Events come from reconciliation. They are not deleted when the current schedule changes.</p>
      </header>
      <div className="flex flex-wrap gap-2 text-sm">
        {WINDOWS.map(([id, label]) => (
          <Link key={id} href={`/changes?window=${id}&scope=${scope}`} className={linkClass(windowKey === id)}>{label}</Link>
        ))}
        <Link href={`/changes?window=${windowKey}&scope=all`} className={linkClass(scope === "all")}>Network</Link>
        <Link href={`/changes?window=${windowKey}&scope=mine`} className={linkClass(scope === "mine")}>My airports</Link>
        <Link href={`/changes?window=${windowKey}&scope=saved`} className={linkClass(scope === "saved")}>Saved routes</Link>
      </div>
      {rows.length === 0 ? <p className="text-sm text-[#8b9790]">No change events in this filter.</p> : (
        <ul className="divide-y divide-[#24302a] border-y border-[#24302a]">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <div className="font-mono text-[11px] uppercase text-[#8b9790]">{row.detectedAt.toISOString()} · {row.changeType} · {row.confidence}</div>
              <Link href={`/routes/${row.originIata}/${row.destinationIata}`} className="text-sm hover:text-[#3dbe7a]">{row.summary}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function linkClass(active: boolean) {
  return `rounded border px-2 py-1 ${active ? "border-[#3dbe7a]" : "border-[#24302a] text-[#8b9790]"}`;
}
