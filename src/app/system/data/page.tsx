import { loadCatalog } from "@/static/load";
import { DataView } from "@/views/data-view";

export default function DataPage() {
  return <DataView catalog={loadCatalog()} />;
}
