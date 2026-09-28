import { loadCatalog } from "@/static/load";
import { RouteView } from "@/views/route-view";

export default async function RoutePage({ params }: { params: Promise<{ origin: string; destination: string }> }) {
  const { origin, destination } = await params;
  return <RouteView catalog={loadCatalog()} origin={origin} destination={destination} />;
}