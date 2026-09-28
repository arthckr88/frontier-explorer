import { AppLink } from "@/components/app-link";
import { staticChanges } from "@/static/adapter";
import type { StaticCatalog } from "@/static/types";

const WINDOWS = [
  ["24h", "24h", 1],
  ["7d", "7d", 7],
  ["30d", "30d", 30],
  ["all", "All", null],
] as const;

export function ChangesView({
  catalog,
  windowKey,
  scope,
}: {
  catalog: StaticCatalog;
  windowKey: string;
  scope: "all" | "mine";
}) {
  const selected = WINDOWS.find((item) => item[0] === windowKey) ?? WINDOWS[2];
  const rows = staticChanges(catalog, selected[2], scope);
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Route changes</h1>
        <p className="text-sm text-[#8b9790]">Recent changes on Frontier routes.</p>
      </header>
      <div className="flex flex-wrap gap-2 text-sm">
        {WINDOWS.map(([id, label]) => (
          <AppLink key={id} href={`/changes?window=${id}&scope=${scope}`} className={linkClass(selected[0] === id)}>
            {label}
          </AppLink>
        ))}
        <AppLink href={`/changes?window=${selected[0]}&scope=all`} className={linkClass(scope === "all")}>
          Network
        </AppLink>
        <AppLink href={`/changes?window=${selected[0]}&scope=mine`} className={linkClass(scope === "mine")}>
          My airports
        </AppLink>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#8b9790]">No change events in this filter.</p>
      ) : (
        <ul className="divide-y divide-[#24302a] border-y border-[#24302a]">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <div className="font-mono text-[11px] uppercase text-[#8b9790]">
                {row.recordedOn} · {row.type}
              </div>
              <AppLink href={`/routes/${row.origin}/${row.destination}`} className="text-sm hover:text-[#3dbe7a]">
                {row.detail}
              </AppLink>
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
