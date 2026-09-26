"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSONSource, Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapAirport, MapRoute } from "@/server/queries/read";

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#3dbe7a",
  UPCOMING: "#3ec6d4",
  ANNOUNCED: "#7eb6ff",
  SEASONAL: "#6aa6ff",
  ENDING_SOON: "#e2a84a",
  POSSIBLY_ENDING: "#e07a3d",
  STALE: "#e07a3d",
  PAUSED: "#8b939c",
  ENDED: "#6b7280",
  UNKNOWN: "#8b939c",
};

const REGIONS = [
  ["all", "All"],
  ["united_states", "United States"],
  ["mexico", "Mexico"],
  ["caribbean", "Caribbean"],
  ["central_america", "Central America"],
  ["south_america", "South America"],
  ["canada", "Canada"],
] as const;

type Props = {
  tileStyle: string;
  routes: MapRoute[];
  airports: MapAirport[];
  interest: string[];
};

export function ExplorerMap({ tileStyle, routes, airports, interest }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [region, setRegion] = useState<(typeof REGIONS)[number][0]>("all");
  const [statuses, setStatuses] = useState<string[]>([
    "ACTIVE",
    "UPCOMING",
    "ANNOUNCED",
    "SEASONAL",
    "ENDING_SOON",
    "POSSIBLY_ENDING",
  ]);
  const [scope, setScope] = useState<"all" | "domestic" | "international">("all");
  const [origin, setOrigin] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [reach, setReach] = useState<"all" | "OAK" | "SFO">("all");
  const [stops, setStops] = useState<0 | 1 | 2 | null>(null);

  const reachable = useMemo(() => {
    if (reach === "all" && stops == null) return null;
    const seeds = reach === "all" ? interest : [reach];
    const adjacency = new Map<string, string[]>();
    for (const route of routes.filter((item) => statuses.includes(item.status))) {
      const list = adjacency.get(route.origin) ?? [];
      list.push(route.destination);
      adjacency.set(route.origin, list);
    }
    const maxStops = stops ?? 2;
    const best = new Map<string, number>();
    const queue = seeds.map((airport) => ({ airport, depth: 0 }));
    while (queue.length) {
      const current = queue.shift();
      if (!current || current.depth > maxStops + 1) continue;
      const seen = best.get(current.airport);
      if (seen != null && seen <= current.depth) continue;
      best.set(current.airport, current.depth);
      for (const next of adjacency.get(current.airport) ?? []) {
        queue.push({ airport: next, depth: current.depth + 1 });
      }
    }
    return best;
  }, [interest, reach, routes, statuses, stops]);

  const visible = useMemo(() => {
    return routes.filter((route) => {
      if (!statuses.includes(route.status)) return false;
      if (region !== "all" && route.originRegion !== region && route.destinationRegion !== region) return false;
      if (scope === "domestic" && route.international) return false;
      if (scope === "international" && !route.international) return false;
      if (reachable && !reachable.has(route.destination) && !reachable.has(route.origin)) return false;
      if (origin && route.origin !== origin && route.destination !== origin) return false;
      return true;
    });
  }, [origin, reachable, region, routes, scope, statuses]);

  const routeData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: visible.map((route) => ({
        type: "Feature" as const,
        properties: {
          origin: route.origin,
          destination: route.destination,
          status: route.status,
          color: STATUS_COLOR[route.status] ?? "#8b939c",
          pair: `${route.origin}-${route.destination}`,
        },
        geometry: { type: "LineString" as const, coordinates: route.coordinates },
      })),
    }),
    [visible],
  );

  const airportData = useMemo(() => {
    const visibleCodes = new Set(visible.flatMap((route) => [route.origin, route.destination]));
    for (const code of interest) visibleCodes.add(code);
    return {
      type: "FeatureCollection" as const,
      features: airports
        .filter((airport) => visibleCodes.has(airport.iata) || routes.length === 0)
        .map((airport) => ({
          type: "Feature" as const,
          properties: {
            iata: airport.iata,
            title: `${airport.iata} · ${airport.city}`,
            mine: interest.includes(airport.iata),
          },
          geometry: { type: "Point" as const, coordinates: [airport.longitude, airport.latitude] },
        })),
    };
  }, [airports, interest, routes.length, visible]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: tileStyle,
      center: [-98.5, 37.5],
      zoom: 3.1,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("routes", { type: "geojson", data: routeData });
      map.addLayer({
        id: "route-lines",
        type: "line",
        source: "routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.4,
          "line-opacity": 0.85,
        },
      });
      map.addSource("airports", { type: "geojson", data: airportData });
      map.addLayer({
        id: "airport-dots",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": ["case", ["get", "mine"], 5, 3.5],
          "circle-color": ["case", ["get", "mine"], "#e8ffb0", "#d5ddd8"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#090b0d",
        },
      });
      map.on("mousemove", "airport-dots", (event) => {
        const feature = event.features?.[0];
        const iata = feature?.properties?.iata;
        if (typeof iata === "string") setHover(iata);
      });
      map.on("mouseleave", "airport-dots", () => setHover(null));
      map.on("click", "airport-dots", (event) => {
        const iata = event.features?.[0]?.properties?.iata;
        if (typeof iata === "string") setOrigin(iata);
      });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; data updates flow through setData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const routeSource = map.getSource("routes");
    const airportSource = map.getSource("airports");
    if (routeSource instanceof GeoJSONSource) routeSource.setData(routeData);
    if (airportSource instanceof GeoJSONSource) airportSource.setData(airportData);
  }, [airportData, routeData]);

  const hovered = airports.find((airport) => airport.iata === hover);
  const outbound = origin ? visible.filter((route) => route.origin === origin) : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-4 rounded-md border border-[#24302a] bg-[#12161b] p-3 text-sm">
        <FilterGroup label="Region">
          {REGIONS.map(([id, label]) => (
            <button key={id} className={chip(region === id)} onClick={() => setRegion(id)} type="button">
              {label}
            </button>
          ))}
        </FilterGroup>
        <FilterGroup label="Status">
          {Object.keys(STATUS_COLOR).map((status) => (
            <button
              key={status}
              type="button"
              className={chip(statuses.includes(status))}
              onClick={() =>
                setStatuses((current) =>
                  current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
                )
              }
            >
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
              {status.replaceAll("_", " ").toLowerCase()}
            </button>
          ))}
        </FilterGroup>
        <FilterGroup label="Scope">
          {(["all", "domestic", "international"] as const).map((item) => (
            <button key={item} className={chip(scope === item)} onClick={() => setScope(item)} type="button">
              {item}
            </button>
          ))}
        </FilterGroup>
        <FilterGroup label="Reach">
          <button className={chip(reach === "OAK")} onClick={() => setReach(reach === "OAK" ? "all" : "OAK")} type="button">
            From OAK
          </button>
          <button className={chip(reach === "SFO")} onClick={() => setReach(reach === "SFO" ? "all" : "SFO")} type="button">
            From SFO
          </button>
          <button className={chip(stops === 0)} onClick={() => setStops(stops === 0 ? null : 0)} type="button">
            Nonstop
          </button>
          <button className={chip(stops === 1)} onClick={() => setStops(stops === 1 ? null : 1)} type="button">
            Within 1 stop
          </button>
          <button className={chip(stops === 2)} onClick={() => setStops(stops === 2 ? null : 2)} type="button">
            Within 2 stops
          </button>
        </FilterGroup>
      </aside>
      <div className="relative min-h-[420px] overflow-hidden rounded-md border border-[#24302a] lg:min-h-[640px]">
        <div ref={container} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-col gap-2 sm:right-auto sm:max-w-sm">
          <div className="pointer-events-auto rounded-md border border-[#24302a] bg-[#090b0d]/90 p-3 text-xs">
            {routes.length === 0 ? (
              <p>No route observations are loaded. Airports you care about are marked. Run a sync to pull Frontier newsroom announcements. Green means a schedule source confirmed the route.</p>
            ) : (
              <p>
                {visible.length} directional routes shown. Announced and unverified routes are not painted as confirmed current service.
              </p>
            )}
            {hovered ? (
              <p className="mt-2 font-mono text-[#e7ece8]">
                {hovered.iata} · {hovered.city}
                <br />
                {visible.filter((route) => route.origin === hovered.iata).length} observed destinations
              </p>
            ) : null}
          </div>
          {origin ? (
            <div className="pointer-events-auto max-h-56 overflow-auto rounded-md border border-[#24302a] bg-[#12161b] p-3 text-xs">
              <div className="mb-2 flex items-center justify-between">
                <a className="font-mono text-sm text-[#e8ffb0]" href={`/airports/${origin}`}>
                  {origin}
                </a>
                <button type="button" className="text-[#8b9790]" onClick={() => setOrigin(null)}>
                  Clear
                </button>
              </div>
              {outbound.length === 0 ? <p className="text-[#8b9790]">No observed destinations in the current filters.</p> : null}
              <ul className="space-y-1">
                {outbound.map((route) => (
                  <li key={`${route.origin}-${route.destination}`}>
                    <a href={`/routes/${route.origin}/${route.destination}`} className="flex justify-between gap-3 hover:text-[#3dbe7a]">
                      <span>
                        {route.origin} → {route.destination}
                      </span>
                      <span className="font-mono text-[#8b9790]">
                        {route.frequency != null ? `${route.frequency}/wk` : route.announcedFrequency != null ? `ann. ${route.announcedFrequency}/wk` : route.status}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function chip(active: boolean) {
  return `rounded border px-2 py-1 text-left text-xs ${active ? "border-[#3dbe7a] text-[#e7ece8]" : "border-[#24302a] text-[#8b9790]"}`;
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8b9790]">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}
