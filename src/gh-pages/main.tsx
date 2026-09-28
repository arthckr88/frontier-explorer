import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
import { LinkModeContext } from "@/components/app-link";
import { Shell } from "@/components/shell";
import { loadCatalogBrowser } from "@/gh-pages/load-browser";
import { staticChrome, staticNetworkAdapter } from "@/static/adapter";
import type { FareQuery, StaticCatalog } from "@/static/types";
import { AirportView } from "@/views/airport-view";
import { ChangesView } from "@/views/changes-view";
import { DataView } from "@/views/data-view";
import { DiscoverView } from "@/views/discover-view";
import { FrequencyView } from "@/views/frequency-view";
import { GoWildView } from "@/views/gowild-view";
import { PopularityView } from "@/views/popularity-view";
import { HomeView } from "@/views/home-view";
import { PlannerView } from "@/views/planner-view";
import { RouteView } from "@/views/route-view";
import { SettingsView } from "@/views/settings-view";

setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).href);

function readRoute() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash) {
    const [pathPart, queryPart] = hash.split("?");
    const path = pathPart?.startsWith("/") ? pathPart : `/${pathPart ?? ""}`;
    return { path: path.replace(/\/$/, "") || "/", params: new URLSearchParams(queryPart ?? "") };
  }
  return { path: "/", params: new URLSearchParams(window.location.search) };
}

function fareQuery(params: URLSearchParams): FareQuery | null {
  const origin = params.get("from")?.trim().toUpperCase() ?? "";
  const destination = params.get("to")?.trim().toUpperCase() ?? "";
  const date = params.get("date")?.trim() ?? "";
  if (!origin || !destination || !date) return null;
  return {
    origin,
    destination,
    date,
    maxStops: Number(params.get("stops") ?? "0"),
    maxDuration: params.get("duration") ? Number(params.get("duration")) : null,
    depart: (params.get("depart") as FareQuery["depart"]) || "",
    arrive: (params.get("arrive") as FareQuery["arrive"]) || "",
    sort: (params.get("sort") as FareQuery["sort"]) || "stops",
    excludeRedEyes: params.get("redeye") !== "0",
  };
}

function App({ catalog }: { catalog: StaticCatalog }) {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const chrome = staticChrome(catalog);
  const network = staticNetworkAdapter(catalog);
  const { path, params } = route;
  let body: ReactNode = null;
  if (path === "/" || path === "/search") {
    const initial = fareQuery(params);
    const homeKey = `${initial?.origin ?? ""}|${initial?.destination ?? ""}|${initial?.date ?? ""}`;
    body = <HomeView key={homeKey} catalog={catalog} network={network} initial={initial} />;
  } else if (path === "/discover") {
    body = <DiscoverView catalog={catalog} from={params.get("from") || ""} stops={Number(params.get("stops") ?? "0")} />;
  } else if (path === "/planner") {
    body = <PlannerView catalog={catalog} moduleKey={params.get("module")} date={params.get("date") || network.home.scheduleThrough || catalog.network.today} />;
  } else if (path === "/changes") {
    const scope = params.get("scope") === "mine" ? "mine" : "all";
    body = <ChangesView catalog={catalog} windowKey={params.get("window") || "30d"} scope={scope} />;
  } else if (path === "/frequency" || path === "/rankings/frequency") {
    body = <FrequencyView catalog={catalog} />;
  } else if (path === "/popularity" || path === "/rankings/popularity") {
    body = <PopularityView catalog={catalog} />;
  } else if (path === "/gowild") {
    body = <GoWildView catalog={catalog} />;
  } else if (path === "/system/data" || path === "/data") {
    body = <DataView catalog={catalog} />;
  } else if (path === "/settings") {
    body = <SettingsView />;
  } else if (path.startsWith("/airports/")) {
    body = <AirportView catalog={catalog} iata={path.split("/")[2] ?? ""} />;
  } else if (path.startsWith("/routes/")) {
    const [, , origin, destination] = path.split("/");
    body = <RouteView catalog={catalog} origin={origin ?? ""} destination={destination ?? ""} />;
  } else {
    body = <HomeView catalog={catalog} network={network} initial={null} />;
  }
  return (
    <LinkModeContext.Provider value="hash">
      <Shell status={chrome.status} links={chrome.links}>
        {body}
      </Shell>
    </LinkModeContext.Provider>
  );
}

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserApp />
    </StrictMode>,
  );
}

function BrowserApp() {
  const [catalog, setCatalog] = useState<StaticCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadCatalogBrowser().then(setCatalog).catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="p-4 text-sm text-[#e2a84a]">The schedule could not be loaded.</p>;
  if (!catalog) return <p className="p-4 text-sm text-[#8b9790]">Loading Frontier schedule.</p>;
  return <App catalog={catalog} />;
}
