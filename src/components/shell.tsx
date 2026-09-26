import Link from "next/link";
import { readFreshness } from "@/server/queries/read";

const LINKS = [
  ["/", "Search"],
  ["/discover", "Discover"],
  ["/planner", "Planner"],
  ["/search", "Search"],
  ["/changes", "Changes"],
  ["/rankings/frequency", "Frequency"],
  ["/rankings/popularity", "Popularity"],
  ["/gowild", "GoWild"],
  ["/system/data", "Data"],
];

export async function Shell({ children }: { children: React.ReactNode }) {
  const freshness = await readFreshness().catch(() => null);
  return (
    <div className="min-h-screen bg-[#090b0d] text-[#e7ece8]">
      <header className="sticky top-0 z-30 border-b border-[#24302a] bg-[#090b0d]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-4 py-3">
          <Link href="/" className="shrink-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#3dbe7a]">Frontier</div>
            <div className="text-sm font-medium tracking-tight">Route Explorer</div>
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm text-[#8b9790]">
            {LINKS.map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-2 py-1 hover:bg-[#181e24] hover:text-[#e7ece8]">
                {label}
              </Link>
            ))}
          </nav>
          <Link href="/settings" className="text-xs text-[#8b9790] hover:text-[#e7ece8]">
            Settings
          </Link>
        </div>
        <div className="border-t border-[#24302a] px-4 py-1.5 font-mono text-[11px] text-[#8b9790]">
          {freshness?.latestAt
            ? `Network sync ${freshness.latestStatus ?? "unknown"} · ${freshness.latestJob ?? "job"} · ${freshness.latestAt}`
            : "No sync has completed. The map stays empty until a source observation is stored."}
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-4">{children}</main>
    </div>
  );
}
