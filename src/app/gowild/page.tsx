import { loadCatalog } from "@/static/load";
import { GoWildView } from "@/views/gowild-view";

export default async function GoWildPage() {
  return <GoWildView catalog={loadCatalog()} />;
}
