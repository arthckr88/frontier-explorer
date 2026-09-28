import { loadCatalog } from "@/static/load";
import { FrequencyView } from "@/views/frequency-view";

export default function FrequencyPage() {
  return <FrequencyView catalog={loadCatalog()} />;
}
