import { loadCatalog } from "@/static/load";
import { DiscoverView } from "@/views/discover-view";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; stops?: string }>;
}) {
  const params = await searchParams;
  return <DiscoverView catalog={loadCatalog()} from={params.from || "OAK"} stops={Number(params.stops ?? "1")} />;
}
