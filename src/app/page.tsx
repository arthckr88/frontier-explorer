import { staticNetworkAdapter } from "@/static/adapter";
import { loadCatalog } from "@/static/load";
import { parseSearchQuery } from "@/static/search";
import { HomeView } from "@/views/home-view";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const catalog = loadCatalog();
  const network = staticNetworkAdapter(catalog);
  const initial = parseSearchQuery(new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
  const homeKey = JSON.stringify(initial);
  return <HomeView key={homeKey} catalog={catalog} network={network} initial={initial} />;
}
