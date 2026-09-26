import { Map as RouteMap, NavigationControl } from "./maplibre-gl.mjs";
import { searchPublished } from "./search.js";

const TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";
const HOME = new Set(["OAK", "SFO", "LAS"]);
const NEW_YORK = ["JFK", "LGA"];

const form = document.querySelector("#search");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const airportCard = document.querySelector("#airport");
const network = document.querySelector("#network");
const showOvernight = document.querySelector("#show-overnight");

let schedule = null;
let airports = new Map();
let map = null;
let arcs = [];
let originPick = "";
let pathPairs = new Set();
let focusPairs = new Set();

load().catch((error) => {
  status.textContent = error instanceof Error ? error.message : "The published schedule did not load.";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  originPick = field("from");
  search();
});

form.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") search();
});

showOvernight.addEventListener("click", () => {
  form.elements.redeye.checked = false;
  search();
});

for (const button of document.querySelectorAll("[data-origin]")) {
  button.addEventListener("click", () => chooseOrigin(button.dataset.origin ?? ""));
}

document.querySelector("#new-york").addEventListener("click", () => {
  if (!originPick && !field("from")) {
    status.textContent = "Choose SFO, OAK, or LAS first.";
    return;
  }
  if (!originPick) originPick = field("from");
  form.elements.from.value = originPick;
  form.elements.to.value = "NYC";
  pressStarts();
  search();
});

async function load() {
  const [flightResponse, airportResponse] = await Promise.all([fetch("flights.json"), fetch("airports.json")]);
  if (!flightResponse.ok) throw new Error("The published schedule did not load.");
  if (!airportResponse.ok) throw new Error("The airport map did not load.");
  schedule = await flightResponse.json();
  airports = new Map((await airportResponse.json()).map((airport) => [airport.iata, airport]));
  arcs = buildArcs();
  const dates = publishedDates();
  if (!form.elements.date.value) {
    const today = new Date().toISOString().slice(0, 10);
    form.elements.date.value = dates.find((date) => date >= today) ?? dates[dates.length - 1] ?? today;
  }
  const listed = (schedule.routes ?? []).filter((route) => route.provenance !== "scheduled").length;
  const scheduled = (schedule.routes ?? []).filter((route) => route.provenance === "scheduled").length;
  network.textContent = `${(schedule.routes ?? []).length.toLocaleString()} routes across the Frontier network. ${scheduled.toLocaleString()} have saved times. ${listed.toLocaleString()} are listed only.`;
  try {
    drawMap();
  } catch {
    map = null;
  }
  const params = new URLSearchParams(location.search);
  if (params.get("from") || params.get("to") || params.get("date")) {
    form.elements.from.value = params.get("from") ?? "";
    form.elements.to.value = params.get("to") ?? "";
    if (params.get("date")) form.elements.date.value = params.get("date");
    originPick = field("from");
    search();
    return;
  }
  status.textContent = dates.length
    ? `Saved flights run ${dates[0]} through ${dates[dates.length - 1]}. Listed routes stay on the map without a departure time.`
    : "Listed routes are on the map. No timed flights are saved in this file.";
}

function chooseOrigin(code) {
  originPick = code;
  form.elements.from.value = code;
  form.elements.to.value = "";
  pathPairs = new Set();
  focusPairs = outboundPairs(code);
  results.replaceChildren();
  showOvernight.hidden = true;
  pressStarts();
  showAirport(code);
  listDestinations(code);
  paintRoutes();
  fit([code, ...destinationsFrom(code)], paddingForSheet());
  const count = focusPairs.size;
  status.textContent = `${place(code)} lists ${count} destination${count === 1 ? "" : "s"}. Choose a second airport, or New York.`;
}

function search() {
  results.replaceChildren();
  showOvernight.hidden = true;
  pathPairs = new Set();
  focusPairs = new Set();
  pressStarts();
  const from = field("from");
  const rawTo = field("to");
  const date = form.elements.date.value;
  originPick = from;
  if (!/^[A-Z]{3}$/.test(from)) {
    status.textContent = "Enter a starting airport.";
    paintRoutes();
    return;
  }
  const to = rawTo === "NYC" ? NEW_YORK : [rawTo];
  if (!to.every((code) => /^[A-Z]{3}$/.test(code)) || to.includes(from)) {
    focusPairs = outboundPairs(from);
    listDestinations(from);
    showAirport(from);
    status.textContent = `${place(from)} lists ${focusPairs.size} destinations. Choose where you are going.`;
    paintRoutes();
    fit([from, ...destinationsFrom(from)], paddingForSheet());
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    status.textContent = "Enter a date.";
    paintRoutes();
    return;
  }
  const target = rawTo === "NYC" ? "New York" : rawTo;
  const listed = to.flatMap((code) => (hasRoute(from, code) ? [`${from}|${code}`] : []));
  if (!publishedDates().includes(date)) {
    focusPairs = new Set(listed);
    status.textContent = `No published flights for ${date} yet. Dates are added by the schedule update, not by this search.`;
    if (listed.length) status.textContent += ` Frontier lists ${from} → ${target}. That route is drawn without a saved departure time.`;
    paintRoutes();
    fit([from, ...to], paddingForSheet());
    return;
  }
  if (!form.elements.nonstop.checked && !form.elements.one.checked && !form.elements.two.checked) {
    status.textContent = "Choose nonstop, 1 stop, or 2 stops.";
    paintRoutes();
    return;
  }
  const found = searchPublished(schedule.flights, {
    from,
    to,
    date,
    stops: {
      nonstop: form.elements.nonstop.checked,
      one: form.elements.one.checked,
      two: form.elements.two.checked,
    },
    excludeRedEyes: form.elements.redeye.checked,
  });
  const hidden = found.hiddenRedEyes;
  if (found.itineraries.length === 0) {
    focusPairs = new Set(listed);
    if (hidden > 0) {
      status.textContent = `No daytime itinerary for ${from} → ${target} on ${date}. ${hidden} overnight flight${hidden === 1 ? " is" : "s are"} hidden.`;
      showOvernight.hidden = false;
    } else if (listed.length) {
      status.textContent = `Frontier lists ${from} → ${target}. No timed flight is saved for ${date}, so this is not shown as a nonstop.`;
    } else {
      status.textContent = `No stored flight for ${from} → ${target} on ${date}.`;
    }
    paintRoutes();
    fit([from, ...to], paddingForSheet());
    return;
  }
  status.textContent = `${found.itineraries.length} itinerar${found.itineraries.length === 1 ? "y" : "ies"} for ${from} → ${target} on ${date}.`;
  if (hidden > 0) {
    status.textContent += ` ${hidden} overnight flight${hidden === 1 ? " is" : "s are"} hidden.`;
    showOvernight.hidden = false;
  }
  found.itineraries.forEach((itinerary, index) => {
    for (const segment of itinerary.segments) pathPairs.add(`${segment.origin}|${segment.destination}`);
    results.append(card(itinerary, date, index === 0));
  });
  paintRoutes();
  const focus = found[0]?.segments.flatMap((segment) => [segment.origin, segment.destination]) ?? [from, ...to];
  fit(focus, paddingForSheet());
}

function card(itinerary, date, selected) {
  const article = document.createElement("button");
  article.type = "button";
  article.className = selected ? "card is-on" : "card";
  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(badge(itinerary.stops === 0 ? "Nonstop" : `${itinerary.stops} stop${itinerary.stops === 1 ? "" : "s"}`));
  if (itinerary.vegasOvernight) badges.append(badge("Overnight in Las Vegas", "vegas"));
  if (itinerary.hasRedEye) badges.append(badge("Red-eye"));
  badges.append(badge(formatElapsed(itinerary.elapsedMinutes)));
  article.append(badges);
  itinerary.segments.forEach((segment, index) => {
    const leg = document.createElement("p");
    leg.className = "leg";
    leg.textContent = `${segment.origin} ${clock(segment.departureLocal)} → ${segment.destination} ${clock(segment.arrivalLocal)}`;
    const meta = document.createElement("p");
    meta.className = "meta";
    const extra = segment.departureLocal.slice(0, 10) === date ? "" : ` · departs ${segment.departureLocal.slice(0, 10)}`;
    meta.textContent = `${segment.flightNumber} · local times${extra}`;
    article.append(leg, meta);
    const connection = itinerary.connections[index];
    if (!connection) return;
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = connection.vegasOvernight ? "Overnight in Las Vegas" : connection.label;
    article.append(note);
  });
  article.addEventListener("click", () => {
    for (const node of results.querySelectorAll(".card")) node.classList.remove("is-on");
    article.classList.add("is-on");
    pathPairs = new Set(itinerary.segments.map((segment) => `${segment.origin}|${segment.destination}`));
    focusPairs = new Set();
    paintRoutes();
    fit(itinerary.segments.flatMap((segment) => [segment.origin, segment.destination]), paddingForSheet());
  });
  return article;
}

function listDestinations(code) {
  const rows = destinationsFrom(code);
  if (!rows.length) return;
  const list = document.createElement("div");
  for (const destination of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    const airport = airports.get(destination);
    const timed = hasScheduled(code, destination);
    button.textContent = `${destination}${airport ? ` ${airport.city}` : ""} · ${timed ? "saved times" : "listed"}`;
    button.addEventListener("click", () => {
      form.elements.from.value = code;
      form.elements.to.value = destination;
      originPick = code;
      search();
    });
    list.append(button);
  }
  results.append(list);
}

function showAirport(code) {
  const airport = airports.get(code);
  if (!airport) {
    airportCard.hidden = true;
    return;
  }
  const outbound = destinationsFrom(code);
  const saved = outbound.filter((destination) => hasScheduled(code, destination)).length;
  airportCard.hidden = false;
  airportCard.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = airport.iata;
  const placeName = document.createElement("p");
  placeName.textContent = `${airport.city} · ${airport.name}`;
  const label = document.createElement("p");
  label.textContent = outbound.length
    ? `${outbound.length} listed destination${outbound.length === 1 ? "" : "s"} · ${saved} with saved times`
    : "No listed departures from this airport.";
  airportCard.append(title, placeName, label);
}

function drawMap() {
  map = new RouteMap({
    container: "map",
    style: TILE_STYLE,
    center: [-98.5, 28],
    zoom: 2.8,
    attributionControl: true,
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    map.addSource("routes", { type: "geojson", data: routeCollection() });
    map.addLayer({
      id: "route-lines",
      type: "line",
      source: "routes",
      paint: {
        "line-color": ["case", [">", ["get", "active"], 0], "#e8ffb0", ["==", ["get", "provenance"], "scheduled"], "#3dbe7a", "#2f6b49"],
        "line-width": ["case", ["==", ["get", "active"], 2], 2.6, ["==", ["get", "active"], 1], 1.7, ["==", ["get", "provenance"], "scheduled"], 1.35, 0.85],
        "line-opacity": ["case", ["==", ["get", "active"], 2], 0.95, ["==", ["get", "active"], 1], 0.88, ["==", ["get", "dim"], true], 0.14, ["==", ["get", "provenance"], "scheduled"], 0.8, 0.42],
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addSource("airports", { type: "geojson", data: airportCollection() });
    map.addLayer({
      id: "airport-dots",
      type: "circle",
      source: "airports",
      paint: {
        "circle-radius": ["case", ["get", "home"], 5.5, ["get", "nyc"], 4.6, 3.2],
        "circle-color": ["case", ["get", "selected"], "#e8ffb0", ["get", "home"], "#e8ffb0", "#d5ddd8"],
        "circle-stroke-width": 1,
        "circle-stroke-color": "#090b0d",
      },
    });
    map.on("mousemove", "airport-dots", (event) => {
      map.getCanvas().style.cursor = "pointer";
      const code = event.features?.[0]?.properties?.iata;
      if (typeof code === "string") showAirport(code);
    });
    map.on("mouseleave", "airport-dots", () => {
      map.getCanvas().style.cursor = "";
      if (originPick) showAirport(originPick);
      else airportCard.hidden = true;
    });
    map.on("click", "airport-dots", (event) => {
      const code = event.features?.[0]?.properties?.iata;
      if (typeof code !== "string") return;
      if (!originPick || code === originPick) chooseOrigin(code);
      else {
        form.elements.from.value = originPick;
        form.elements.to.value = code;
        search();
      }
    });
    paintRoutes();
    if (pathPairs.size === 0 && focusPairs.size === 0) fit(airports.keys(), { left: 420, bottom: 48, right: 40, top: 40 });
  });
  window.addEventListener("resize", () => map?.resize());
}

function buildArcs() {
  const routes = schedule?.routes?.length ? schedule.routes : scheduledRoutes();
  const built = [];
  for (const route of routes) {
    const from = airports.get(route.origin);
    const to = airports.get(route.destination);
    if (!from || !to) continue;
    built.push({
      origin: route.origin,
      destination: route.destination,
      provenance: route.provenance === "scheduled" ? "scheduled" : "listed",
      coordinates: greatCircleArc([from.lon, from.lat], [to.lon, to.lat], 8),
    });
  }
  return built;
}

function scheduledRoutes() {
  const seen = new Set();
  const routes = [];
  for (const flight of schedule?.flights ?? []) {
    const key = `${flight.origin}|${flight.destination}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ origin: flight.origin, destination: flight.destination, provenance: "scheduled" });
  }
  return routes;
}

function routeCollection() {
  const dim = pathPairs.size > 0 || focusPairs.size > 0;
  const features = arcs.map((arc) => {
    const key = `${arc.origin}|${arc.destination}`;
    const active = pathPairs.has(key) ? 2 : focusPairs.has(key) ? 1 : 0;
    return {
      type: "Feature",
      properties: { origin: arc.origin, destination: arc.destination, provenance: arc.provenance, active, dim: dim && active === 0 },
      geometry: { type: "LineString", coordinates: arc.coordinates },
    };
  });
  features.sort((left, right) => left.properties.active - right.properties.active);
  return { type: "FeatureCollection", features };
}

function airportCollection() {
  const selected = new Set([originPick, field("to") === "NYC" ? "" : field("to"), ...(field("to") === "NYC" ? NEW_YORK : [])]);
  return {
    type: "FeatureCollection",
    features: [...airports.values()].map((airport) => ({
      type: "Feature",
      properties: { iata: airport.iata, home: HOME.has(airport.iata), nyc: NEW_YORK.includes(airport.iata) || airport.iata === "EWR", selected: selected.has(airport.iata) },
      geometry: { type: "Point", coordinates: [airport.lon, airport.lat] },
    })),
  };
}

function paintRoutes() {
  const routes = map?.getSource("routes");
  if (routes) routes.setData(routeCollection());
  const dots = map?.getSource("airports");
  if (dots) dots.setData(airportCollection());
}

function outboundPairs(code) {
  return new Set(destinationsFrom(code).map((destination) => `${code}|${destination}`));
}

function destinationsFrom(code) {
  const found = new Set();
  for (const route of schedule?.routes ?? []) {
    if (route.origin === code) found.add(route.destination);
  }
  if (found.size === 0) {
    for (const flight of schedule?.flights ?? []) {
      if (flight.origin === code) found.add(flight.destination);
    }
  }
  return [...found].sort();
}

function hasRoute(origin, destination) {
  return (schedule?.routes ?? []).some((route) => route.origin === origin && route.destination === destination) || (schedule?.flights ?? []).some((flight) => flight.origin === origin && flight.destination === destination);
}

function hasScheduled(origin, destination) {
  return (schedule?.routes ?? []).some((route) => route.origin === origin && route.destination === destination && route.provenance === "scheduled") || (schedule?.flights ?? []).some((flight) => flight.origin === origin && flight.destination === destination);
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
  map.fitBounds(bounds, { padding, maxZoom: 4.8, duration: 500 });
}

function paddingForSheet() {
  if (window.innerWidth <= 800) return { top: 150, left: 24, right: 24, bottom: Math.round(window.innerHeight * 0.5) };
  return { top: 48, left: 430, right: 48, bottom: 48 };
}

function publishedDates() {
  return [...new Set((schedule?.flights ?? []).map((flight) => flight.date))].sort();
}

function field(name) {
  return String(form.elements[name].value ?? "").trim().toUpperCase();
}

function place(code) {
  const airport = airports.get(code);
  return airport ? `${code} ${airport.city}` : code;
}

function pressStarts() {
  for (const button of document.querySelectorAll("[data-origin]")) {
    button.setAttribute("aria-pressed", button.dataset.origin === originPick ? "true" : "false");
  }
  document.querySelector("#new-york").setAttribute("aria-pressed", field("to") === "NYC" ? "true" : "false");
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

function greatCircleArc(start, end, steps = 8) {
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
    if (previous && Math.abs(current[0] - previous[0]) > 180) output.push([current[0] + (current[0] > previous[0] ? -360 : 360), current[1]]);
    else output.push(current);
  }
  return output;
}

function toRad(degrees) { return (degrees * Math.PI) / 180; }
function toDeg(radians) { return (radians * 180) / Math.PI; }
