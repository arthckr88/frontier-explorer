import { AppLink } from "@/components/app-link";
import type { StaticCatalog } from "@/static/types";

export function PopularityView({ catalog }: { catalog: StaticCatalog }) {
  const popularity = catalog.historical?.popularity;
  if (!popularity) return <p className="text-sm text-[#8b9790]">Popularity is not loaded.</p>;
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Popularity</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">{popularity.note}</p>
        <p className="font-mono text-xs text-[#3ec6d4]">
          {popularity.source}. {popularity.period}. {popularity.pairs.length} historical city pairs. Passenger totals are not stored.
        </p>
      </header>
      <div className="max-h-[640px] space-y-1 overflow-auto">
        {popularity.pairs.map((pair) => (
          <AppLink key={`${pair.origin}${pair.destination}`} href={`/routes/${pair.origin}/${pair.destination}`} className="block rounded border border-[#24302a] px-2 py-1 text-sm hover:text-[#3dbe7a]">
            {pair.origin} → {pair.destination}
          </AppLink>
        ))}
      </div>
    </section>
  );
}
