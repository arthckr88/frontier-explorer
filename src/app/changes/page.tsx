import { loadCatalog } from "@/static/load";
import { ChangesView } from "@/views/changes-view";

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const scope = params.scope === "mine" ? "mine" : "all";
  return <ChangesView catalog={loadCatalog()} windowKey={params.window || "30d"} scope={scope} />;
}
