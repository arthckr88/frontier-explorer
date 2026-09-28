import { AppLink } from "@/components/app-link";
import type { StaticCatalog } from "@/static/types";

export function PopularityView({ catalog }: { catalog: StaticCatalog }) {
  const popularity = catalog.historical?.popularity;
  if (!popularity) return <p className="text-sm text-[#8b9790]">Popularity is not loaded.</p>;
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Popularity</h1>
        <p className="max-w-2xl text-sm text-[#8b9790]">Historical DOT/BTS data. Not proof of current Frontier service.</p>
        <p className="font-mono text-xs text-[#3ec6d4]">
          {popularity.source}. {popularity.period}. {popularity.routes.length} directed routes.
        </p>
      </header>
      <ol className="max-h-[640px] space-y-1 overflow-auto">
        {popularity.routes.map((route, index) => (
          <li key={`${route.origin}${route.destination}`} className="rounded border border-[#24302a] px-2 py-1 text-sm">
            <span className="mr-2 font-mono text-[#8b9790]">{index + 1}.</span>
            <AppLink href={`/routes/${route.origin}/${route.destination}`} className="hover:text-[#3dbe7a]">
              {route.origin} → {route.destination}
            </AppLink>
            <span className="ml-2 font-mono text-[#c5d0c9]">{route.passengers.toLocaleString("en-US")} passengers</span>
            <span className="ml-2 font-mono text-[#8b9790]">{route.departuresPerformed.toLocaleString("en-US")} departures</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
