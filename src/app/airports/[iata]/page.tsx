import { loadCatalog } from "@/static/load";
import { AirportView } from "@/views/airport-view";

export default async function AirportPage({ params }: { params: Promise<{ iata: string }> }) {
  const { iata } = await params;
  return <AirportView catalog={loadCatalog()} iata={iata} />;
}
