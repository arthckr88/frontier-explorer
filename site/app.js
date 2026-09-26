import { Map as RouteMap, NavigationControl } from "./maplibre-gl.mjs";
import { searchPublished } from "./search.js";

const TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";
const HOME = new Set(["OAK", "SFO", "LAS"]);

const form = document.querySelector("#search");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const airportCard = document.querySelector("#airport");

let schedule = null;
let airports = new Map();
let map = null;
let pinned = null;
let activePairs = new Set();

load().catch((error) => {
  status.textContent = error instanceof Error ? error.message : "The published schedule did not load.";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  render(
    String(data.get("from") ?? "").trim().toUpperCase(),
    String(data.get("to") ?? "").trim().toUpperCase(),
    String(data.get("date") ?? "").trim(),
  );
});

async function load() {
  const [flightResponse, airportResponse] = await Promise.all([fetch("flights.json"), fetch("airports.json")]);
  if (!flightResponse.ok) throw new Error("The published schedule did not load.");
  if (!airportResponse.ok) throw new Error("The airport map did not load.");
  schedule = await flightResponse.json();
  airports = new Map((await airportResponse.json()).map((airport) => [airport.iata, airport]));
  try {
    drawMap();
  } catch {
    map = null;
  }
  const params = new URLSearchParams(location.search);
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const date = params.get("date") ?? "";
  if (from || to || date) {
    form.elements.from.value = from;
    form.elements.to.value = to;
    form.elements.date.value = date;
    render(from.trim().toUpperCase(), to.trim().toUpperCase(), date.trim());
    return;
  }
  const dates = publishedDates();
  status.textContent = dates.length
    ? `Published ${dates[0]} through ${dates[dates.length - 1]}. Search does not add flights.`
    : "No published flights are in this file.";
}

function drawMap() {
  map = new RouteMap({
    container: "map",
    style: TILE_STYLE,
    center: [-98.5, 37.2],
    zoom: 3.2,
    attributionControl: true,
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    map.addSource("routes", { type: "geojson", data: routeCollection(activePairs) });
    map.addLayer({
      id: "route-lines",
      type: "line",
      source: "routes",
      paint: {
        "line-color": ["case", ["==", ["get", "active"], true], "#e8ffb0", "#3dbe7a"],
        "line-width": ["case", ["==", ["get", "active"], true], 2.4, 1.4],
        "line-opacity": ["case", ["==", ["get", "dim"], true], 0.28, 0.82],
      },
    });
    map.addSource("airports", { type: "geojson", data: airportCollection() });
    map.addLayer({
      id: "airport-dots",
      type: "circle",
      source: "airports",
      paint: {
        "circle-radius": ["case", ["get", "home"], 5.5, 3.6],
        "circle-color": ["case", ["get", "home"], "#e8ffb0", "#d5ddd8"],
        "circle-stroke-width": 1,
        "circle-stroke-color": "#090b0d",
      },
    });
    map.on("mousemove", "airport-dots", (event) => {
      map.getCanvas().style.cursor = "pointer";
      const code = event.features?.[0]?.properties?.iata;
      if (!pinned && typeof code === "string") showAirport(code);
    });
    map.on("mouseleave", "airport-dots", () => {
      map.getCanvas().style.cursor = "";
      if (!pinned) airportCard.hidden = true;
    });
    map.on("click", "airport-dots", (event) => {
      const code = event.features?.[0]?.properties?.iata;
      if (typeof code !== "string") return;
      pinned = code;
      form.elements.from.value = code;
      showAirport(code);
    });
    map.on("click", (event) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: ["airport-dots"] });
      if (hits.length) return;
      pinned = null;
      airportCard.hidden = true;
    });
    if (activePairs.size === 0) fit(airports.keys(), { left: 400, bottom: 80, right: 40, top: 40 });
  });
  window.addEventListener("resize", () => map?.resize());
}

function render(from, to, date) {
  results.replaceChildren();
  activePairs = new Set();
  if (!schedule) {
    status.textContent = "The published schedule is still loading.";
    return;
  }
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    status.textContent = "Enter two different airport codes and a date.";
    paintRoutes();
    return;
  }
  if (!publishedDates().includes(date)) {
    status.textContent = `No published flights for ${date} yet. Dates are added by the schedule update, not by this search.`;
    paintRoutes();
    return;
  }
  const found = searchPublished(schedule.flights, { from, to, date });
  if (found.length === 0) {
    status.textContent = `No stored flight for ${from} → ${to} on ${date}.`;
    paintRoutes();
    return;
  }
  status.textContent = `${found.length} itinerar${found.length === 1 ? "y" : "ies"} for ${from} → ${to} on ${date}.`;
  found.forEach((itinerary, index) => {
    for (const segment of itinerary.segments) activePairs.add(`${segment.origin}|${segment.destination}`);
    results.append(card(itinerary, date, index === 0));
  });
  paintRoutes();
  const focus = found[0]?.segments.flatMap((segment) => [segment.origin, segment.destination]) ?? [];
  fit(focus, paddingForSheet());
}

function card(itinerary, date, selected) {
  const article = document.createElement("button");
  article.type = "button";
  article.className = selected ? "card is-on" : "card";
  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(badge(itinerary.stops === 0 ? "Nonstop" : `${itinerary.stops} stop`));
  if (itinerary.vegasOvernight) badges.append(badge("Overnight in Las Vegas", "vegas"));
  badges.append(badge(formatElapsed(itinerary.elapsedMinutes)));
  article.append(badges);
  for (const segment of itinerary.segments) {
    const leg = document.createElement("p");
    leg.className = "leg";
    leg.textContent = `${segment.origin} ${clock(segment.departureLocal)} → ${segment.destination} ${clock(segment.arrivalLocal)}`;
    const meta = document.createElement("p");
    meta.className = "meta";
    const extra = segment.departureLocal.slice(0, 10) === date ? "" : ` · departs ${segment.departureLocal.slice(0, 10)}`;
    meta.textContent = `${segment.flightNumber} · local times${extra}`;
    article.append(leg, meta);
  }
  if (itinerary.connectionLabel && !itinerary.vegasOvernight) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = itinerary.connectionLabel;
    article.append(note);
  }
  article.addEventListener("click", () => {
    for (const node of results.querySelectorAll(".card")) node.classList.remove("is-on");
    article.classList.add("is-on");
    activePairs = new Set(itinerary.segments.map((segment) => `${segment.origin}|${segment.destination}`));
    paintRoutes();
    fit(itinerary.segments.flatMap((segment) => [segment.origin, segment.destination]), paddingForSheet());
  });
  return article;
}

function showAirport(code) {
  const airport = airports.get(code);
  if (!airport) return;
  const outbound = departures(code);
  airportCard.hidden = false;
  airportCard.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = airport.iata;
  const place = document.createElement("p");
  place.textContent = `${airport.city} · ${airport.name}`;
  const label = document.createElement("p");
  label.textContent = outbound.length ? "Published departures" : "No published departures from this airport.";
  airportCard.append(title, place, label);
  if (!outbound.length) return;
  const list = document.createElement("ul");
  list.className = "dest-list";
  for (const row of outbound) {
    const item = document.createElement("li");
    item.className = "dest";
    const dest = airports.get(row.destination);
    item.textContent = `${row.destination}${dest ? ` ${dest.city}` : ""} · ${row.count} flight${row.count === 1 ? "" : "s"}`;
    list.append(item);
  }
  airportCard.append(list);
}

function departures(origin) {
  const counts = new Map();
  for (const flight of schedule?.flights ?? []) {
    if (flight.origin !== origin) continue;
    counts.set(flight.destination, (counts.get(flight.destination) ?? 0) + 1);
  }
  return [...counts].map(([destination, count]) => ({ destination, count })).sort((a, b) => b.count - a.count || a.destination.localeCompare(b.destination));
}

function routeCollection(active) {
  const pairs = new Map();
  for (const flight of schedule?.flights ?? []) {
    pairs.set(`${flight.origin}|${flight.destination}`, { origin: flight.origin, destination: flight.destination });
  }
  const dim = active.size > 0;
  return {
    type: "FeatureCollection",
    features: [...pairs.values()].flatMap((pair) => {
      const from = airports.get(pair.origin);
      const to = airports.get(pair.destination);
      if (!from || !to) return [];
      const key = `${pair.origin}|${pair.destination}`;
      return [{
        type: "Feature",
        properties: { origin: pair.origin, destination: pair.destination, active: active.has(key), dim: dim && !active.has(key) },
        geometry: { type: "LineString", coordinates: greatCircleArc([from.lon, from.lat], [to.lon, to.lat]) },
      }];
    }),
  };
}

function airportCollection() {
  const codes = new Set();
  for (const flight of schedule?.flights ?? []) {
    codes.add(flight.origin);
    codes.add(flight.destination);
  }
  return {
    type: "FeatureCollection",
    features: [...codes].flatMap((code) => {
      const airport = airports.get(code);
      if (!airport) return [];
      return [{
        type: "Feature",
        properties: { iata: code, home: HOME.has(code) },
        geometry: { type: "Point", coordinates: [airport.lon, airport.lat] },
      }];
    }),
  };
}

function paintRoutes() {
  const source = map?.getSource("routes");
  if (source) source.setData(routeCollection(activePairs));
}

function fit(codes, padding) {
  if (!map) return;
  const bounds = [...codes].reduce((box, code) => {
    const airport = airports.get(code);
    if (!airport) return box;
    if (!box) return [[airport.lon, airport.lat], [airport.lon, airport.lat]];
    box[0][0] = Math.min(box[0][0], airport.lon);
    box[0][1] = Math.min(box[0][1], airport.lat);
    box[1][0] = Math.max(box[1][0], airport.lon);
    box[1][1] = Math.max(box[1][1], airport.lat);
    return box;
  }, null);
  if (!bounds) return;
  map.fitBounds(bounds, { padding, maxZoom: 5.4, duration: 600 });
}

function paddingForSheet() {
  if (window.innerWidth <= 800) return { top: 120, left: 24, right: 24, bottom: Math.round(window.innerHeight * 0.48) };
  return { top: 48, left: 420, right: 48, bottom: 80 };
}

function publishedDates() {
  return [...new Set((schedule?.flights ?? []).map((flight) => flight.date))].sort();
}

function badge(text, kind) {
  const span = document.createElement("span");
  span.className = kind ? `badge ${kind}` : "badge";
  span.textContent = text;
  return span;
}

function clock(local) {
  const match = /T(\d{2}):(\d{2})/.exec(local);
  if (!match) return local;
  const hour24 = Number(match[1]);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  return `${hour24 % 12 || 12}:${match[2]} ${suffix}`;
}

function formatElapsed(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours <= 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function greatCircleArc(start, end, steps = 48) {
  const [lon1, lat1] = [toRad(start[0]), toRad(start[1])];
  const [lon2, lat2] = [toRad(end[0]), toRad(end[1])];
  const central = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (central === 0) return [start, end];
  const coords = [];
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const a = Math.sin((1 - fraction) * central) / Math.sin(central);
    const b = Math.sin(fraction * central) / Math.sin(central);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    coords.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return splitAntimeridian(coords);
}

function splitAntimeridian(coords) {
  const output = [];
  for (const current of coords) {
    const previous = output[output.length - 1];
    if (previous && Math.abs(current[0] - previous[0]) > 180) {
      output.push([current[0] + (current[0] > previous[0] ? -360 : 360), current[1]]);
    } else {
      output.push(current);
    }
  }
  return output;
}

function toRad(degrees) { return (degrees * Math.PI) / 180; }
function toDeg(radians) { return (radians * 180) / Math.PI; }
