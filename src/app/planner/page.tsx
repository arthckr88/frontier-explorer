import { loadCatalog } from "@/static/load";
import { PlannerView } from "@/views/planner-view";

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string; date?: string }>;
}) {
  const params = await searchParams;
  const catalog = loadCatalog();
  return <PlannerView catalog={catalog} moduleKey={params.module ?? null} date={params.date || catalog.network.today} />;
}
