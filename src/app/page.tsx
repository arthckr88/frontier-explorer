import { staticNetworkAdapter } from "@/static/adapter";
import { loadCatalog } from "@/static/load";
import type { FareQuery } from "@/static/types";
import { HomeView } from "@/views/home-view";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string; stops?: string }>;
}) {
  const params = await searchParams;
  const catalog = loadCatalog();
  const network = staticNetworkAdapter(catalog);
  const initial: FareQuery | null =
    params.from && params.to && params.date
      ? {
          origin: params.from.toUpperCase(),
          destination: params.to.toUpperCase(),
          date: params.date,
          maxStops: Number(params.stops ?? "0"),
          maxDuration: null,
          depart: "",
          arrive: "",
          sort: "stops",
          excludeRedEyes: true,
        }
      : null;
  return <HomeView catalog={catalog} network={network} initial={initial} />;
}
