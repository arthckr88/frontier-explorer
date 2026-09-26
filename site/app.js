import { Map as RouteMap, NavigationControl } from "./maplibre-gl.mjs";
import { searchPublished } from "./search.js";

const TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";
const HOME = new Set(["OAK", "SFO", "LAS"]);
const GROUPS = [
  {
    id: "new-york",
    label: "New York",
    queries: ["new york", "nyc"],
    airports: [
      { code: "JFK" },
      { code: "LGA" },
      { code: "EWR", note: "optional" },
    ],
  },
  {
    id: "la",
    label: "LA",
    queries: ["la", "los angeles", "l.a."],
    airports: [{ code: "LAX" }, { code: "BUR" }, { code: "SNA" }, { code: "ONT" }],
  },
  {
    id: "bay",
    label: "Bay Area",
    queries: ["bay area", "bay", "sf bay"],
    airports: [{ code: "OAK" }, { code: "SFO" }, { code: "SJC", note: "nearby" }],
  },
];

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
let applyingField = false;

load().catch((error) => {
  status.textContent = error instanceof Error ? error.message : "The published schedule did not load.";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  for (const name of ["from", "to"]) {
    const list = document.querySelector(`#${name}-list`);
    const input = form.elements[name];
    if (list && !list.hidden && !completionSelection(input.value)) {
      const [item] = suggestions(input.value);
      if (item) applySuggestion(name, item, false);
    }
  }
  originPick = readEndpoint("from").codes[0] ?? "";
  search();
});

form.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.name === "redeye" || target.name === "stops" || target.name === "sort" || target.name === "date") search();
});

for (const name of ["from", "to"]) {
  const input = form.elements[name];
  input.addEventListener("input", () => {
    if (applyingField) return;
    if (input.value.trim() !== input.dataset.label) {
      input.dataset.codes = "";
      input.dataset.label = "";
      input.dataset.notes = "";
    }
    const selection = completionSelection(input.value);
    syncClear();
    if (selection) {
      applyResolved(name, selection);
      return;
    }
    renderSuggest(name);
  });
  input.addEventListener("focus", () => renderSuggest(name));
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      closeSuggest(name);
      if (applyingField || document.activeElement === input) return;
      if (input.value.trim() === input.dataset.label && input.dataset.codes) return;
      const selection = completionSelection(input.value);
      if (selection) applyResolved(name, selection);
    }, 160);
  });
}

showOvernight.addEventListener("click", () => {
  form.elements.redeye.checked = false;
  search();
});

document.querySelector("#clear").addEventListener("click", () => clearSearch());

for (const button of document.querySelectorAll("[data-origin]")) {
  button.addEventListener("click", () => chooseOrigin(button.dataset.origin ?? ""));
}

document.querySelector("#new-york").addEventListener("click", () => {
  if (!readEndpoint("from").codes.length) {
    status.textContent = "Choose SFO, OAK, or LAS first.";
    return;
  }
  setEndpoint("to", groupSelection(GROUPS[0]));
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
    if (params.get("from")) setEndpoint("from", selectionFromParam(params.get("from")));
    if (params.get("to")) setEndpoint("to", selectionFromParam(params.get("to")));
    if (params.get("date")) form.elements.date.value = params.get("date");
    originPick = readEndpoint("from").codes[0] ?? "";
    search();
    return;
  }
  status.textContent = dates.length
    ? `Saved flights run ${dates[0]} through ${dates[dates.length - 1]}. Listed routes stay on the map without a departure time.`
    : "Listed routes are on the map. No timed flights are saved in this file.";
}

function chooseOrigin(code) {
  originPick = code;
  setEndpoint("from", airportSelection(code));
  if (readEndpoint("to").codes.some((item) => item !== code)) {
    search();
    return;
  }
  clearEndpoint("to");
  pathPairs = new Set();
  const saved = savedDestinations(code);
  focusPairs = new Set(saved.map((destination) => `${code}|${destination}`));
  results.replaceChildren();
  showOvernight.hidden = true;
  pressStarts();
  showAirport(code);
  listDestinations(code);
  paintRoutes();
  fit([code, ...saved], paddingForSheet());
  status.textContent = saved.length
    ? `${cityName(code)}. Saved flights to ${saved.map(cityName).join(", ")}.`
    : `${cityName(code)}. No saved departures from this airport.`;
}

function search() {
  if (!schedule) return;
  results.replaceChildren();
  showOvernight.hidden = true;
  pathPairs = new Set();
  focusPairs = new Set();
  closeSuggest("from");
  closeSuggest("to");
  commitField("from");
  commitField("to");
  pressStarts();
  const from = readEndpoint("from");
  const to = readEndpoint("to");
  const date = form.elements.date.value;
  originPick = from.codes[0] ?? "";
  if (!from.codes.length) {
    status.textContent = "Choose a starting airport.";
    paintRoutes();
    return;
  }
  const destinations = to.codes.filter((code) => !from.codes.includes(code));
  if (!destinations.length) {
    const saved = from.codes.flatMap((code) => savedDestinations(code));
    focusPairs = new Set(from.codes.flatMap((code) => savedDestinations(code).map((destination) => `${code}|${destination}`)));
    if (from.codes.length === 1) {
      listDestinations(from.codes[0]);
      showAirport(from.codes[0]);
    }
    status.textContent = saved.length
      ? `${endTitle(from)}. Saved flights to ${saved.map(cityName).join(", ")}.`
      : `${endTitle(from)}. No saved departures from this airport.`;
    paintRoutes();
    fit([...from.codes, ...saved], paddingForSheet());
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    status.textContent = "Enter a date.";
    paintRoutes();
    return;
  }
  const title = `${endTitle(from)} → ${destinations.length === 1 ? cityName(destinations[0]) : endTitle(to)}`;
  const listed = listedDirects(from.codes, destinations).length > 0;
  const maxStops = Number(form.elements.stops.value);
  let hidden = 0;
  let itineraries = [];
  for (const origin of from.codes) {
    const found = searchPublished(schedule.flights, {
      from: origin,
      to: destinations,
      date,
      stops: { nonstop: true, one: maxStops >= 1, two: maxStops >= 2 },
      excludeRedEyes: form.elements.redeye.checked,
    });
    hidden += found.hiddenRedEyes;
    itineraries.push(...found.itineraries);
  }
  itineraries = sortItineraries(itineraries, form.elements.sort.value);
  for (const itinerary of itineraries) {
    for (const segment of itinerary.segments) pathPairs.add(`${segment.origin}|${segment.destination}`);
  }
  if (itineraries.length === 0) {
    if (!publishedDates().includes(date)) {
      status.textContent = `No published flights for ${date} yet. Dates are added by the schedule update, not by this search.`;
      if (listed) status.textContent += ` ${title}. Frontier lists this route. No departure time is saved.`;
    } else if (hidden > 0) {
      status.textContent = `No daytime itinerary for ${title} on ${date}. ${hiddenCopy(hidden)}`;
      showOvernight.hidden = false;
    } else if (listed) {
      status.textContent = `${title}. Frontier lists this route. No departure time is saved.`;
    } else {
      status.textContent = `${title}. No saved itinerary on ${date}.`;
    }
    paintRoutes();
    fit([...from.codes, ...destinations], paddingForSheet());
    return;
  }
  status.textContent = `${itineraries.length} itinerar${itineraries.length === 1 ? "y" : "ies"} for ${title} on ${date}.`;
  if (hidden > 0) {
    status.textContent += ` ${hiddenCopy(hidden)}`;
    showOvernight.hidden = false;
  }
  itineraries.forEach((itinerary, index) => results.append(card(itinerary, date, index === 0, to.notes)));
  paintRoutes();
  const focus = itineraries.flatMap((itinerary) => itinerary.segments.flatMap((segment) => [segment.origin, segment.destination]));
  fit(focus, paddingForSheet());
}

function card(itinerary, date, selected, notes = {}) {
  const article = document.createElement("article");
  article.className = selected ? "card is-on" : "card";
  const badges = document.createElement("div");
  badges.className = "badges";
  const path = document.createElement("button");
  path.type = "button";
  path.className = "path";
  path.append(badge(itinerary.stops === 0 ? "Nonstop" : `${itinerary.stops} stop${itinerary.stops === 1 ? "" : "s"}`));
  if (itinerary.vegasOvernight) path.append(badge("Overnight in Las Vegas", "vegas"));
  if (itinerary.hasRedEye) path.append(badge("Red-eye"));
  const last = itinerary.segments[itinerary.segments.length - 1];
  if (last && notes[last.destination]) path.append(badge(notes[last.destination]));
  path.append(badge(formatElapsed(itinerary.elapsedMinutes)));
  path.addEventListener("click", () => {
    focusSavedFlight(article, path, itinerary.segments, itineraryStatus(itinerary));
  });
  badges.append(path);
  article.append(badges);
  itinerary.segments.forEach((segment, index) => {
    const leg = document.createElement("button");
    leg.type = "button";
    leg.className = "leg";
    leg.textContent = `${cityName(segment.origin)} ${clock(segment.departureLocal)} → ${cityName(segment.destination)} ${clock(segment.arrivalLocal)}`;
    leg.addEventListener("click", () => focusSavedFlight(article, leg, [segment], flightStatus(segment)));
    const meta = document.createElement("p");
    meta.className = "meta";
    const extra = segment.departureLocal.slice(0, 10) === date ? "" : ` · departs ${segment.departureLocal.slice(0, 10)}`;
    meta.textContent = `${segment.flightNumber} · local times${extra}`;
    article.append(leg, meta);
    const connection = itinerary.connections[index];
    const outbound = itinerary.segments[index + 1];
    if (!connection || !outbound) return;
    const note = document.createElement("button");
    note.type = "button";
    note.className = "layover";
    note.textContent = connection.vegasOvernight
      ? `Overnight in Las Vegas · ${formatElapsed(connection.minutes)}`
      : `${formatElapsed(connection.minutes)} in ${cityName(connection.airport)}`;
    note.addEventListener("click", () => {
      focusSavedFlight(article, note, [segment, outbound], layoverStatus(connection, segment, outbound));
    });
    article.append(note);
  });
  return article;
}

function focusSavedFlight(article, control, segments, text) {
  for (const node of results.querySelectorAll(".card, .leg, .layover, .path")) node.classList.remove("is-on");
  article.classList.add("is-on");
  control.classList.add("is-on");
  pathPairs = new Set(segments.map((segment) => `${segment.origin}|${segment.destination}`));
  focusPairs = new Set();
  status.textContent = text;
  paintRoutes();
  fit(segments.flatMap((segment) => [segment.origin, segment.destination]), paddingForSheet());
}

function flightStatus(segment) {
  return `${cityName(segment.origin)} → ${cityName(segment.destination)}. Flight ${segment.flightNumber}, ${clock(segment.departureLocal)}–${clock(segment.arrivalLocal)}.`;
}

function layoverStatus(connection, inbound, outbound) {
  return `${cityName(connection.airport)}. Flight ${inbound.flightNumber} arrives ${clock(inbound.arrivalLocal)}. Flight ${outbound.flightNumber} departs ${clock(outbound.departureLocal)}.`;
}

function itineraryStatus(itinerary) {
  const first = itinerary.segments[0];
  const last = itinerary.segments[itinerary.segments.length - 1];
  const flights = itinerary.segments.map((segment) => segment.flightNumber).join(", ");
  return `${cityName(first.origin)} → ${cityName(last.destination)}. Flights ${flights}.`;
}

function listDestinations(code) {
  const rows = savedDestinations(code);
  if (!rows.length) return;
  const list = document.createElement("div");
  for (const destination of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.textContent = `${cityName(destination)} · ${destination}`;
    button.addEventListener("click", () => {
      setEndpoint("from", airportSelection(code));
      setEndpoint("to", airportSelection(destination));
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
      const from = readEndpoint("from");
      if (!from.codes.length || (from.codes.length === 1 && from.codes[0] === code)) chooseOrigin(code);
      else {
        setEndpoint("to", airportSelection(code));
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
  const selected = new Set([...readEndpoint("from").codes, ...readEndpoint("to").codes]);
  return {
    type: "FeatureCollection",
    features: [...airports.values()].map((airport) => ({
      type: "Feature",
      properties: { iata: airport.iata, home: HOME.has(airport.iata), nyc: ["JFK", "LGA", "EWR"].includes(airport.iata), selected: selected.has(airport.iata) },
      geometry: { type: "Point", coordinates: [airport.lon, airport.lat] },
    })),
  };
}

function paintRoutes() {
  const routes = map?.getSource("routes");
  if (routes) routes.setData(routeCollection());
  const dots = map?.getSource("airports");
  if (dots) dots.setData(airportCollection());
  const canvas = document.querySelector("#map");
  if (canvas) {
    canvas.dataset.selected = [...pathPairs].join(",");
    canvas.dataset.focus = [...focusPairs].join(",");
  }
}

function outboundPairs(code) {
  return new Set(destinationsFrom(code).map((destination) => `${code}|${destination}`));
}

function savedDestinations(code) {
  const date = form.elements.date.value;
  const found = new Set();
  for (const flight of schedule?.flights ?? []) {
    if (flight.origin === code && flight.date === date) found.add(flight.destination);
  }
  return [...found].sort();
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

function listedDirects(origins, destinations) {
  const pairs = [];
  for (const origin of origins) {
    for (const destination of destinations) {
      if (origin !== destination && hasRoute(origin, destination)) pairs.push([origin, destination]);
    }
  }
  return pairs;
}

function sortItineraries(itineraries, mode) {
  const copy = [...itineraries];
  const depart = (itinerary) => itinerary.segments[0]?.departureUtc ?? "";
  copy.sort((left, right) => {
    if (mode === "duration") return left.elapsedMinutes - right.elapsedMinutes || left.stops - right.stops || depart(left).localeCompare(depart(right));
    if (mode === "depart") return depart(left).localeCompare(depart(right)) || left.stops - right.stops || left.elapsedMinutes - right.elapsedMinutes;
    return left.stops - right.stops || depart(left).localeCompare(depart(right)) || left.elapsedMinutes - right.elapsedMinutes;
  });
  return copy;
}

function hiddenCopy(count) {
  return `${count} overnight flight${count === 1 ? " is" : "s are"} hidden.`;
}

function applySuggestion(name, item, runSearch = true) {
  if (item.kind === "group") setEndpoint(name, groupSelection(item.group));
  else {
    setEndpoint(name, airportSelection(item.code, item.note));
    if (name === "from") originPick = item.code;
  }
  closeSuggest(name);
  if (runSearch && readEndpoint("from").codes.length && readEndpoint("to").codes.length) search();
}

function renderSuggest(name) {
  const input = form.elements[name];
  const list = document.querySelector(`#${name}-list`);
  const items = suggestions(input.value);
  list.replaceChildren();
  if (!items.length || document.activeElement !== input) {
    list.hidden = true;
    return;
  }
  for (const item of items) {
    const entry = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    if (item.kind === "group") {
      button.append(item.group.label);
      const note = document.createElement("span");
      note.className = "note";
      note.textContent = item.group.airports.map((airport) => airport.note ? `${airport.code} ${airport.note}` : airport.code).join(", ");
      button.append(note);
    } else {
      button.append(`${item.code} · ${cityName(item.code)}`);
      if (item.note) {
        const note = document.createElement("span");
        note.className = "note";
        note.textContent = item.note;
        button.append(note);
      }
    }
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySuggestion(name, item);
    });
    entry.append(button);
    list.append(entry);
  }
  list.hidden = false;
}

function suggestions(value) {
  const query = value.trim().toLowerCase().replaceAll(".", "");
  if (query.length < 2) return [];
  const items = [];
  const used = new Set();
  for (const group of GROUPS) {
    const hit = group.queries.some((name) => name.replaceAll(".", "") === query || (query.length >= 3 && name.startsWith(query)));
    if (!hit) continue;
    items.push({ kind: "group", group });
    for (const airport of group.airports) {
      used.add(airport.code);
      items.push({ kind: "airport", code: airport.code, note: airport.note });
    }
  }
  if (query === "la") return items;
  const ranked = [...airports.values()].filter((airport) => {
    if (used.has(airport.iata)) return false;
    const city = airport.city.toLowerCase();
    const code = airport.iata.toLowerCase();
    return code.startsWith(query) || city.startsWith(query);
  });
  ranked.sort((left, right) => Number(right.iata.toLowerCase().startsWith(query)) - Number(left.iata.toLowerCase().startsWith(query)) || left.city.localeCompare(right.city));
  for (const airport of ranked.slice(0, 8)) items.push({ kind: "airport", code: airport.iata });
  return items.slice(0, 12);
}

function closeSuggest(name) {
  const list = document.querySelector(`#${name}-list`);
  if (list) list.hidden = true;
}

function applyResolved(name, selection) {
  applyingField = true;
  setEndpoint(name, selection);
  applyingField = false;
  if (name === "from") originPick = selection.codes[0] ?? "";
  closeSuggest(name);
  search();
}

function commitField(name) {
  const input = form.elements[name];
  const stored = (input.dataset.codes ?? "").split(",").filter((code) => /^[A-Z]{3}$/.test(code));
  if (stored.length && input.value.trim() === input.dataset.label) return;
  const selection = resolveLoose(input.value);
  if (!selection) return;
  applyingField = true;
  setEndpoint(name, selection);
  applyingField = false;
  if (name === "from") originPick = selection.codes[0] ?? originPick;
}

function completionSelection(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2 || airports.size === 0) return null;
  const query = trimmed.toLowerCase().replaceAll(".", "");
  const raw = query.toUpperCase();
  if (/^[A-Z]{3}$/.test(raw)) {
    if (!airports.has(raw)) return null;
    const blocked = [...airports.values()].some((airport) => airport.iata !== raw && (airport.iata.toLowerCase().startsWith(query) || airport.city.toLowerCase().startsWith(query)))
      || GROUPS.some((group) => group.label.toLowerCase().startsWith(query) || group.queries.some((name) => {
        const normalized = name.replaceAll(".", "");
        return normalized.startsWith(query) && normalized !== query;
      }));
    if (blocked) return null;
    return airportSelection(raw);
  }
  const cityHits = [...airports.values()].filter((airport) => airport.city.toLowerCase() === query);
  if (cityHits.length === 1) return airportSelection(cityHits[0].iata);
  const group = GROUPS.find((item) => item.label.toLowerCase() === query || item.queries.some((name) => name.replaceAll(".", "") === query));
  if (!group) return null;
  const codePrefix = [...airports.values()].some((airport) => airport.iata.toLowerCase().startsWith(query) && airport.iata.length > query.length);
  if (codePrefix) return null;
  return groupSelection(group);
}

function resolveLoose(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const query = trimmed.toLowerCase().replaceAll(".", "");
  const raw = query.toUpperCase();
  if (/^[A-Z]{3}$/.test(raw) && airports.has(raw)) return airportSelection(raw);
  const cityHits = [...airports.values()].filter((airport) => airport.city.toLowerCase() === query);
  if (cityHits.length === 1) return airportSelection(cityHits[0].iata);
  const group = GROUPS.find((item) => item.label.toLowerCase() === query || item.queries.some((name) => name.replaceAll(".", "") === query));
  if (group) return groupSelection(group);
  if (/^[A-Z]{3}$/.test(raw)) return airportSelection(raw);
  return null;
}

function endTitle(selection) {
  if (selection.codes.length === 1) return cityName(selection.codes[0]);
  if (selection.label && !selection.label.includes("·")) return selection.label;
  return selection.codes.map((code) => cityName(code)).join(", ");
}

function setEndpoint(name, selection) {
  const input = form.elements[name];
  input.value = selection.label;
  input.dataset.codes = selection.codes.join(",");
  input.dataset.label = selection.label;
  input.dataset.notes = JSON.stringify(selection.notes ?? {});
}

function clearEndpoint(name) {
  const input = form.elements[name];
  input.value = "";
  input.dataset.codes = "";
  input.dataset.label = "";
  input.dataset.notes = "";
}

function readEndpoint(name) {
  const input = form.elements[name];
  const stored = (input.dataset.codes ?? "").split(",").filter((code) => /^[A-Z]{3}$/.test(code));
  if (stored.length && input.value.trim() === input.dataset.label) {
    let notes = {};
    try { notes = JSON.parse(input.dataset.notes || "{}"); } catch { notes = {}; }
    return { label: input.dataset.label, codes: stored, notes };
  }
  return resolveLoose(input.value) ?? { label: input.value.trim(), codes: [], notes: {} };
}

function airportSelection(code, note) {
  const notes = note ? { [code]: note } : {};
  return { label: `${code} · ${cityName(code)}`, codes: [code], notes };
}

function groupSelection(group) {
  const notes = {};
  for (const airport of group.airports) if (airport.note) notes[airport.code] = airport.note;
  return { label: group.label, codes: group.airports.map((airport) => airport.code), notes };
}

function selectionFromParam(value) {
  const token = value.trim();
  const group = GROUPS.find((item) => item.id === token.toLowerCase() || item.label.toLowerCase() === token.toLowerCase() || token.toUpperCase() === "NYC" && item.id === "new-york");
  if (group) return groupSelection(group);
  return airportSelection(token.toUpperCase());
}

function cityName(code) {
  return airports.get(code)?.city || code;
}

function place(code) {
  const airport = airports.get(code);
  return airport ? `${code} ${airport.city}` : code;
}

function pressStarts() {
  const from = readEndpoint("from");
  for (const button of document.querySelectorAll("[data-origin]")) {
    button.setAttribute("aria-pressed", from.codes.length === 1 && button.dataset.origin === from.codes[0] ? "true" : "false");
  }
  document.querySelector("#new-york").setAttribute("aria-pressed", readEndpoint("to").label === "New York" ? "true" : "false");
  syncClear();
}

function clearSearch() {
  const date = form.elements.date.value;
  const stops = form.elements.stops.value;
  const sort = form.elements.sort.value;
  const redeye = form.elements.redeye.checked;
  clearEndpoint("from");
  clearEndpoint("to");
  originPick = "";
  pathPairs = new Set();
  focusPairs = new Set();
  results.replaceChildren();
  showOvernight.hidden = true;
  airportCard.hidden = true;
  closeSuggest("from");
  closeSuggest("to");
  form.elements.date.value = date;
  form.elements.stops.value = stops;
  form.elements.sort.value = sort;
  form.elements.redeye.checked = redeye;
  pressStarts();
  paintRoutes();
  fit([...airports.keys()], window.innerWidth <= 800 ? paddingForSheet() : { left: 420, bottom: 48, right: 40, top: 40 });
  const dates = publishedDates();
  status.textContent = dates.length
    ? `Saved flights run ${dates[0]} through ${dates[dates.length - 1]}. Listed routes stay on the map without a departure time.`
    : "Listed routes are on the map. No timed flights are saved in this file.";
}

function syncClear() {
  const from = form.elements.from;
  const to = form.elements.to;
  document.querySelector("#clear").hidden = !from.value.trim() && !to.value.trim();
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
