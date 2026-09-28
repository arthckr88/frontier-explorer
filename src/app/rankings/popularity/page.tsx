import { loadCatalog } from "@/static/load";
import { PopularityView } from "@/views/popularity-view";

export default function PopularityPage() {
  return <PopularityView catalog={loadCatalog()} />;
}
