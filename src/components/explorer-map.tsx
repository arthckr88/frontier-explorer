"use client";

import { useEffect, useMemo, useRef } from "react";
import { GeoJSONSource, Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapAirport, MapRoute } from "@/server/queries/read";

type Props = {
  tileStyle: string;
  routes: MapRoute[];
  airports: MapAirport[];
  interest: string[];
  focusAirport?: string | null;
  selected?: { origin: string; destination: string } | null;
};

export function ExplorerMap({ tileStyle, routes, airports, interest, focusAirport = null, selected = null }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const fitRef = useRef<() => void>(() => {});

  const routeData = useMemo(() => {
    const selectedKey = selected ? `${selected.origin}|${selected.destination}` : "";
    const marking = Boolean(focusAirport) || Boolean(selectedKey);
    const features = routes.map((route) => {
      const key = `${route.origin}|${route.destination}`;
      const scheduled = route.status === "SCHEDULE_CONFIRMED" || route.status === "SCHEDULE_CONFIRMED_ONLY";
      let active = 0;
      if (selectedKey && key === selectedKey) active = 2;
      else if (focusAirport && (route.origin === focusAirport || route.destination === focusAirport)) active = 1;
      return {
        type: "Feature" as const,
        properties: {
          origin: route.origin,
          destination: route.destination,
          active,
          dim: marking && active === 0 ? 1 : 0,
          scheduled: scheduled ? 1 : 0,
        },
        geometry: { type: "LineString" as const, coordinates: route.coordinates },
      };
    });
    features.sort((left, right) => left.properties.active - right.properties.active);
    return { type: "FeatureCollection" as const, features };
  }, [focusAirport, routes, selected]);

  const airportData = useMemo(() => {
    const hot = new Set<string>();
    if (focusAirport) hot.add(focusAirport);
    if (selected?.origin) hot.add(selected.origin);
    if (selected?.destination) hot.add(selected.destination);
    return {
      type: "FeatureCollection" as const,
      features: airports.map((airport) => ({
        type: "Feature" as const,
        properties: {
          iata: airport.iata,
          hot: hot.has(airport.iata),
          mine: interest.includes(airport.iata),
        },
        geometry: { type: "Point" as const, coordinates: [airport.longitude, airport.latitude] },
      })),
    };
  }, [airports, focusAirport, interest, selected]);

  const frame = useMemo(() => frameAirports(routes, airports, focusAirport, selected), [airports, focusAirport, routes, selected]);

  const dataRef = useRef({ routeData, airportData, frame });
  useEffect(() => {
    dataRef.current = { routeData, airportData, frame };
  }, [airportData, frame, routeData]);

  useEffect(() => {
    fitRef.current = () => {
      const map = mapRef.current;
      const points = dataRef.current.frame;
      if (!map || points.length === 0) return;
      let west = 180;
      let south = 90;
      let east = -180;
      let north = -90;
      for (const airport of points) {
        west = Math.min(west, airport.longitude);
        east = Math.max(east, airport.longitude);
        south = Math.min(south, airport.latitude);
        north = Math.max(north, airport.latitude);
      }
      if (west > east || south > north) return;
      const focused = Boolean(dataRef.current.routeData.features.some((feature) => feature.properties.active > 0));
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 36, maxZoom: focused ? 6.2 : 5.4, duration: 0 },
      );
    };
  }, []);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: tileStyle,
      center: [-98.5, 37.5],
      zoom: 3.1,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const paint = () => {
      if (!map.getSource("routes")) return;
      const current = dataRef.current;
      const routeSource = map.getSource("routes");
      const airportSource = map.getSource("airports");
      if (routeSource instanceof GeoJSONSource) routeSource.setData(current.routeData);
      if (airportSource instanceof GeoJSONSource) airportSource.setData(current.airportData);
      fitRef.current();
    };
    map.on("load", () => {
      map.addSource("routes", { type: "geojson", data: dataRef.current.routeData });
      map.addLayer({
        id: "route-lines",
        type: "line",
        source: "routes",
        paint: {
          "line-color": ["case", [">", ["get", "active"], 0], "#e8ffb0", ["==", ["get", "scheduled"], 1], "#3dbe7a", "#2f6b49"],
          "line-width": ["case", ["==", ["get", "active"], 2], 2.6, ["==", ["get", "active"], 1], 1.7, ["==", ["get", "scheduled"], 1], 1.35, 0.85],
          "line-opacity": ["case", ["==", ["get", "active"], 2], 0.95, ["==", ["get", "active"], 1], 0.88, ["==", ["get", "dim"], 1], 0.14, ["==", ["get", "scheduled"], 1], 0.8, 0.42],
        },
      });
      map.addSource("airports", { type: "geojson", data: dataRef.current.airportData });
      map.addLayer({
        id: "airport-dots",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": ["case", ["get", "hot"], 5.5, ["get", "mine"], 4.2, 3.2],
          "circle-color": ["case", ["get", "hot"], "#e8ffb0", "#d5ddd8"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#090b0d",
        },
      });
      paint();
    });
    const observer = new ResizeObserver(() => {
      map.resize();
      if (map.isStyleLoaded() && map.getSource("routes")) fitRef.current();
    });
    observer.observe(container.current);
    mapRef.current = map;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [tileStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getSource("routes")) return;
    const routeSource = map.getSource("routes");
    const airportSource = map.getSource("airports");
    if (routeSource instanceof GeoJSONSource) routeSource.setData(routeData);
    if (airportSource instanceof GeoJSONSource) airportSource.setData(airportData);
    fitRef.current();
  }, [airportData, routeData]);

  return (
    <div className="h-full min-h-0 w-full overflow-hidden rounded-md border border-[#24302a]">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}

function frameAirports(
  routes: MapRoute[],
  airports: MapAirport[],
  focusAirport: string | null,
  selected: { origin: string; destination: string } | null,
) {
  const byCode = new Map(airports.map((airport) => [airport.iata, airport]));
  if (selected?.origin && selected.destination) {
    const pair = [byCode.get(selected.origin), byCode.get(selected.destination)].filter((airport): airport is MapAirport => Boolean(airport));
    if (pair.length > 0) return pair;
  }
  if (focusAirport) {
    const codes = new Set<string>([focusAirport]);
    for (const route of routes) {
      if (route.origin === focusAirport || route.destination === focusAirport) {
        codes.add(route.origin);
        codes.add(route.destination);
      }
    }
    const focused = [...codes].map((code) => byCode.get(code)).filter((airport): airport is MapAirport => Boolean(airport));
    if (focused.length > 0) return focused;
  }
  return airports;
}
