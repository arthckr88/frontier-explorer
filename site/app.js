import { Map as RouteMap, NavigationControl } from "./maplibre-gl.mjs";
import { filterItineraries, searchPublished } from "./search.js";

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
let networkFile = null;
let airports = new Map();
let map = null;
let arcs = [];
let arcIndex = new Set();
let outbound = new Map();
let inbound = new Map();
let originPick = "";
let pathPairs = new Set();
let airportPairs = new Set();
let connectionHubs = [];
let focusPairs = new Set();
let applyingField = false;
let isolatePath = false;
let airportFocus = false;
let showNetwork = false;
const routeCache = new Map();

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
  syncFiltersToggle();
  if (target.name === "stops" && !tripSelected()) {
    if (readEndpoint("from").codes.length) showSelectedAirport();
    return;
  }
  if (target.name === "redeye" || target.name === "stops" || target.name === "sort" || target.name === "date" || target.name === "duration" || target.name === "depart" || target.name === "arrive" || target.name === "layover") search();
});

const filtersPanel = document.querySelector("#filters");
const filtersToggle = document.querySelector("#filters-toggle");
filtersToggle.addEventListener("click", () => setFiltersOpen(filtersPanel.hidden));
for (const button of document.querySelectorAll(".filters-close")) {
  button.addEventListener("click", () => setFiltersOpen(false));
}
syncFiltersToggle();

const hubInput = form.elements.hub;
hubInput.addEventListener("input", () => {
  renderHubSuggest();
  syncFiltersToggle();
  const raw = hubInput.value.trim();
  if (!raw || resolveHub(raw)) search();
});
hubInput.addEventListener("focus", () => renderHubSuggest());
hubInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    document.querySelector("#hub-list").hidden = true;
    if (document.activeElement === hubInput) return;
    const raw = hubInput.value.trim();
    if (!raw || resolveHub(raw)) search();
  }, 160);
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

document.querySelector("#network-toggle").addEventListener("click", () => {
  showNetwork = !showNetwork;
  syncNetworkToggle();
  paintRoutes();
  fitCurrentRoutes();
});

for (const button of document.querySelectorAll("[data-origin]")) {
  button.addEventListener("click", () => selectAirport(button.dataset.origin ?? ""));
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
  const [flightResponse, airportResponse, nonstopResponse] = await Promise.all([
    fetch("flights.json"),
    fetch("airports.json"),
    fetch("nonstops.json"),
  ]);
  if (!flightResponse.ok) throw new Error("The published schedule did not load.");
  if (!airportResponse.ok) throw new Error("The airport map did not load.");
  if (!nonstopResponse.ok) throw new Error("The nonstop network did not load.");
  schedule = await flightResponse.json();
  networkFile = await nonstopResponse.json();
  airports = new Map((await airportResponse.json()).map((airport) => [airport.iata, airport]));
  arcs = buildArcs();
  const dates = publishedDates();
  if (!form.elements.date.value) {
    const today = new Date().toISOString().slice(0, 10);
    form.elements.date.value = dates.find((date) => date >= today) ?? dates[dates.length - 1] ?? today;
  }
  network.textContent = describeNetwork();
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
  status.textContent = openingStatus(dates);
}

function toIsDestination(originCodes) {
  return readEndpoint("to").codes.some((code) => !originCodes.includes(code));
}

function showOrigin(selection) {
  originPick = selection.codes[0] ?? "";
  const previous = applyingField;
  applyingField = true;
  setEndpoint("from", selection);
  clearEndpoint("to");
  applyingField = previous;
  closeSuggest("from");
  closeSuggest("to");
  showSelectedAirport();
}

function selectAirport(code) {
  if (!airports.has(code)) return;
  showOrigin(airportSelection(code));
}

function tripSelected() {
  const from = readEndpoint("from");
  const to = readEndpoint("to");
  return from.codes.length > 0 && to.codes.some((code) => !from.codes.includes(code));
}

function showSelectedAirport() {
  const from = readEndpoint("from");
  if (!from.codes.length) return;
  const maxStops = Number(form.elements.stops.value);
  results.replaceChildren();
  showOvernight.hidden = true;
  pathPairs = new Set();
  focusPairs = new Set();
  airportPairs = new Set();
  airportFocus = true;
  isolatePath = true;
  showNetwork = false;
  const reached = new Map();
  for (const code of from.codes) {
    const routes = routesFromAirport(code, Number.isFinite(maxStops) ? maxStops : 0);
    for (const segment of routes.segments) airportPairs.add(segment);
    for (const [destination, stops] of routes.reached) {
      const previous = reached.get(destination);
      if (previous === undefined || stops < previous) reached.set(destination, stops);
    }
  }
  originPick = from.codes[0] ?? "";
  pressStarts();
  if (from.codes.length === 1) showAirport(from.codes[0]);
  else airportCard.hidden = true;
  listReached(reached);
  status.textContent = airportStatus(from, reached, maxStops);
  paintRoutes();
  fitCurrentRoutes();
}

function search() {
  if (!schedule) return;
  closeSuggest("from");
  closeSuggest("to");
  commitField("from");
  commitField("to");
  const from = readEndpoint("from");
  const to = readEndpoint("to");
  const destinations = to.codes.filter((code) => !from.codes.includes(code));
  if (from.codes.length && !destinations.length) {
    if (from.codes.length === 1 && airports.has(from.codes[0])) selectAirport(from.codes[0]);
    else showOrigin(from);
    return;
  }
  airportFocus = false;
  airportPairs = new Set();
  results.replaceChildren();
  showOvernight.hidden = true;
  pathPairs = new Set();
  focusPairs = new Set();
  isolatePath = false;
  pressStarts();
  const date = form.elements.date.value;
  originPick = from.codes[0] ?? "";
  if (!from.codes.length) {
    status.textContent = "Choose a starting airport.";
    paintRoutes();
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    status.textContent = "Enter a date.";
    paintRoutes();
    return;
  }
  const title = `${endTitle(from)} → ${endTitle(to)}`;
  const maxStops = Number(form.elements.stops.value);
  isolatePath = true;
  showNetwork = false;
  const published = publishedTripSegments(from.codes, destinations, maxStops);
  for (const segment of published.segments) pathPairs.add(segment);
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
  connectionHubs = hubsIn(itineraries);
  const filtered = filterItineraries(itineraries, readFilterQuery());
  const visible = filtered.itineraries;
  if (visible.length > 0) {
    for (const segment of visible[0].segments) pathPairs.add(`${segment.origin}|${segment.destination}`);
  }
  const alternatives = savedTripDates(from.codes, destinations, maxStops).filter((hit) => hit.date !== date);
  if (visible.length === 0) {
    if (published.direct.size) status.textContent = `${title}. Published nonstop, no saved departure on ${date}.`;
    else if (published.segments.size) status.textContent = `${title}. Published connection, no saved departure on ${date}.`;
    else if (itineraries.length > 0) status.textContent = filterEmptyMessage(filtered.hidden, title, date);
    else if (hidden > 0) status.textContent = `No daytime itinerary for ${title} on ${date}.`;
    else status.textContent = `${title}. No saved flight for this route.`;
    if (hidden > 0) {
      status.textContent += ` ${hiddenCopy(hidden)}`;
      showOvernight.hidden = false;
    }
    if (alternatives.length) showDateChoices(alternatives);
    paintRoutes();
    fitCurrentRoutes();
    return;
  }
  status.textContent = `${visible.length} itinerar${visible.length === 1 ? "y" : "ies"} for ${title} on ${date}.`;
  const filterNote = filterHideNote(filtered.hidden);
  if (filterNote) status.textContent += ` ${filterNote}`;
  if (hidden > 0) {
    status.textContent += ` ${hiddenCopy(hidden)}`;
    showOvernight.hidden = false;
  }
  visible.forEach((itinerary, index) => results.append(card(itinerary, date, index === 0, to.notes)));
  paintRoutes();
  fitCurrentRoutes();
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
  article.addEventListener("click", (event) => {
    if (event.target.closest(".leg, .layover")) return;
    focusSavedFlight(article, path, itinerary.segments, itineraryStatus(itinerary));
  });
  badges.append(path);
  article.append(badges);
  itinerary.segments.forEach((segment, index) => {
    const leg = document.createElement("button");
    leg.type = "button";
    leg.className = "leg";
    leg.textContent = `${airportPlace(segment.origin)} ${clock(segment.departureLocal)} → ${airportPlace(segment.destination)} ${clock(segment.arrivalLocal)}`;
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
      : `${formatElapsed(connection.minutes)} in ${airportPlace(connection.airport)}`;
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
  fitCurrentRoutes();
}

function flightStatus(segment) {
  return `${airportPlace(segment.origin)} → ${airportPlace(segment.destination)}. Flight ${segment.flightNumber}, ${clock(segment.departureLocal)}–${clock(segment.arrivalLocal)}.`;
}

function layoverStatus(connection, inbound, outbound) {
  return `${airportPlace(connection.airport)}. Flight ${inbound.flightNumber} arrives ${clock(inbound.arrivalLocal)}. Flight ${outbound.flightNumber} departs ${clock(outbound.departureLocal)}.`;
}

function itineraryStatus(itinerary) {
  const first = itinerary.segments[0];
  const last = itinerary.segments[itinerary.segments.length - 1];
  const flights = itinerary.segments.map((segment) => segment.flightNumber).join(", ");
  return `${airportPlace(first.origin)} → ${airportPlace(last.destination)}. Flights ${flights}.`;
}

function listReached(reached) {
  const rows = [...reached.entries()].sort((left, right) => left[1] - right[1] || airportPlace(left[0]).localeCompare(airportPlace(right[0])));
  if (!rows.length) return;
  const list = document.createElement("div");
  for (const [code, stops] of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.textContent = stops === 0 ? airportPlace(code) : `${airportPlace(code)} · ${stops} stop${stops === 1 ? "" : "s"}`;
    button.addEventListener("click", () => selectAirport(code));
    list.append(button);
  }
  results.append(list);
}

function airportStatus(from, reached, maxStops) {
  const place = from.codes.length === 1 ? airportPlace(from.codes[0]) : endTitle(from);
  const groups = [[], [], []];
  for (const [code, stops] of reached) groups[Math.min(stops, 2)].push(code);
  const saved = [...new Set(from.codes.flatMap((code) => savedDestinations(code)))].sort();
  const savedNote = saved.length ? ` Saved flight times to ${saved.map(airportPlace).join(", ")}.` : "";
  if (!reached.size) {
    return `${place}. No published nonstop from this airport.${savedNote}`;
  }
  const nonstopNames = groups[0].map(airportPlace).sort((left, right) => left.localeCompare(right));
  const nonstopText = nonstopNames.length <= 8 ? nonstopNames.join(", ") : `${nonstopNames.length} airports`;
  if (maxStops === 0) return `${place}. Nonstop to ${nonstopText}.${savedNote}`;
  const limit = `Up to ${maxStops} stop${maxStops === 1 ? "" : "s"}`;
  let text = `${place}. ${limit}. Nonstop to ${nonstopText}.`;
  if (groups[1].length) text += ` ${groups[1].length} with 1 stop.`;
  if (maxStops >= 2 && groups[2].length) text += ` ${groups[2].length} with 2 stops.`;
  return `${text}${savedNote}`;
}

function showAirport(code) {
  const airport = airports.get(code);
  if (!airport) {
    airportCard.hidden = true;
    return;
  }
  const maxStops = Number(form.elements.stops.value);
  const reached = routesFromAirport(code, Number.isFinite(maxStops) ? maxStops : 0).reached;
  airportCard.hidden = false;
  airportCard.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = airport.iata;
  const placeName = document.createElement("p");
  placeName.textContent = `${airport.city} · ${airport.name}`;
  const label = document.createElement("p");
  label.textContent = reachSummary(reached, maxStops);
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
      selectAirport(code);
    });
    paintRoutes();
    map.on("moveend", () => paintRoutes());
    fitCurrentRoutes();
  });
  window.addEventListener("resize", () => {
    map?.resize();
    fitCurrentRoutes();
  });
}

function buildArcs() {
  const seen = new Set();
  const built = [];
  arcIndex = new Set();
  outbound = new Map();
  inbound = new Map();
  routeCache.clear();
  for (const pair of networkFile?.pairs ?? []) {
    const key = `${pair.origin}|${pair.destination}`;
    if (seen.has(key)) continue;
    const arc = arcFrom(pair.origin, pair.destination);
    if (!arc) continue;
    seen.add(key);
    arcIndex.add(key);
    const next = outbound.get(pair.origin) ?? [];
    next.push(pair.destination);
    outbound.set(pair.origin, next);
    const previous = inbound.get(pair.destination) ?? [];
    previous.push(pair.origin);
    inbound.set(pair.destination, previous);
    built.push(arc);
  }
  return built;
}

function routesFromAirport(code, maxStops) {
  const cacheKey = `${code}|${maxStops}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;
  const maxHops = maxStops + 1;
  const segments = new Set();
  const reached = new Map();
  const stack = [{ airport: code, hops: 0, seen: new Set([code]) }];
  while (stack.length) {
    const current = stack.pop();
    if (current.hops >= maxHops) continue;
    for (const next of outbound.get(current.airport) ?? []) {
      if (current.seen.has(next)) continue;
      segments.add(`${current.airport}|${next}`);
      const stops = current.hops;
      const previous = reached.get(next);
      if (previous === undefined || stops < previous) reached.set(next, stops);
      const seen = new Set(current.seen);
      seen.add(next);
      stack.push({ airport: next, hops: current.hops + 1, seen });
    }
  }
  const result = { segments, reached };
  routeCache.set(cacheKey, result);
  return result;
}

function reachSummary(reached, maxStops) {
  if (!reached.size) return "No published nonstop from this airport.";
  if (maxStops === 0) {
    const names = [...reached.keys()].map(airportPlace).sort((left, right) => left.localeCompare(right));
    if (names.length === 1) return `Nonstop to ${names[0]}.`;
    return `${names.length} nonstop destinations.`;
  }
  return `${reached.size} place${reached.size === 1 ? "" : "s"} within ${maxStops} stop${maxStops === 1 ? "" : "s"}.`;
}

function arcFrom(origin, destination) {
  const from = airports.get(origin);
  const to = airports.get(destination);
  if (!from || !to) return null;
  return {
    origin,
    destination,
    provenance: "scheduled",
    coordinates: greatCircleArc([from.lon, from.lat], [to.lon, to.lat], 8),
  };
}

function savedFlightPair(origin, destination) {
  return (schedule?.flights ?? []).some((flight) => flight.origin === origin && flight.destination === destination);
}

function nonstopCodes() {
  const codes = new Set();
  for (const arc of arcs) {
    codes.add(arc.origin);
    codes.add(arc.destination);
  }
  return codes;
}

function nonstopPairCount() {
  return arcs.length;
}

function describeNetwork() {
  if (networkFile?.sentence) return networkFile.sentence;
  const pairs = nonstopPairCount();
  if (!pairs) return "No published nonstop is on the map.";
  return `${pairs.toLocaleString()} published nonstop city pairs.`;
}

function openingStatus(dates) {
  if (!dates.length) return "No saved flight times are loaded.";
  return `Saved flight times run ${dates[0]} through ${dates[dates.length - 1]}.`;
}

function pathKeys() {
  return pathPairs;
}

function routeFeature(arc, selected, dim) {
  const key = `${arc.origin}|${arc.destination}`;
  const active = selected.has(key) ? 2 : focusPairs.has(key) ? 1 : 0;
  return {
    type: "Feature",
    properties: { origin: arc.origin, destination: arc.destination, provenance: arc.provenance, active, dim: dim && active === 0 },
    geometry: { type: "LineString", coordinates: arc.coordinates },
  };
}

function routeCollection() {
  const pathOnly = isolatePath && !airportFocus && !showNetwork;
  const airportOnly = airportFocus && !showNetwork;
  const selected = pathKeys();
  const dim = !pathOnly && !airportOnly && (selected.size > 0 || focusPairs.size > 0);
  const features = [];
  const seen = new Set();
  if (!pathOnly && !airportOnly) {
    for (const arc of arcs) {
      seen.add(`${arc.origin}|${arc.destination}`);
      features.push(routeFeature(arc, selected, dim));
    }
  }
  if (airportOnly) {
    for (const key of airportPairs) {
      if (!arcIndex.has(key)) continue;
      const [origin, destination] = key.split("|");
      const arc = arcFrom(origin, destination);
      if (!arc) continue;
      features.push({
        type: "Feature",
        properties: { origin, destination, provenance: arc.provenance, active: 0, dim: false },
        geometry: { type: "LineString", coordinates: arc.coordinates },
      });
    }
  }
  for (const key of selected) {
    if (seen.has(key) || airportOnly) continue;
    const [origin, destination] = key.split("|");
    if (!arcIndex.has(key) && !savedFlightPair(origin, destination)) continue;
    const arc = arcFrom(origin, destination);
    if (!arc) continue;
    features.push(routeFeature(arc, selected, dim));
  }
  features.sort((left, right) => left.properties.active - right.properties.active);
  return { type: "FeatureCollection", features };
}

function airportCollection() {
  const selected = new Set([...readEndpoint("from").codes, ...readEndpoint("to").codes]);
  const keep = nonstopCodes();
  if ((isolatePath || airportFocus) && !showNetwork) {
    keep.clear();
    const keys = airportFocus ? airportPairs : pathKeys();
    for (const key of keys) {
      const [origin, destination] = key.split("|");
      keep.add(origin);
      keep.add(destination);
    }
    if (keep.size === 0) {
      for (const code of selected) keep.add(code);
    }
  }
  const records = [...airports.values()].filter((airport) => keep.has(airport.iata));
  return {
    type: "FeatureCollection",
    features: records.map((airport) => ({
      type: "Feature",
      properties: { iata: airport.iata, home: HOME.has(airport.iata), nyc: ["JFK", "LGA", "EWR"].includes(airport.iata), selected: selected.has(airport.iata) },
      geometry: { type: "Point", coordinates: [airport.lon, airport.lat] },
    })),
  };
}

function paintRoutes() {
  const collection = routeCollection();
  const airportsOnMap = airportCollection();
  const routes = map?.getSource("routes");
  if (routes) routes.setData(collection);
  const dots = map?.getSource("airports");
  if (dots) dots.setData(airportsOnMap);
  const canvas = document.querySelector("#map");
  if (canvas) {
    canvas.dataset.selected = [...pathKeys()].join(",");
    canvas.dataset.focus = [...focusPairs].join(",");
    canvas.dataset.mode = airportFocus && !showNetwork ? "airport" : isolatePath && !showNetwork ? "path" : "network";
    canvas.dataset.airport = airportFocus ? readEndpoint("from").codes.join(",") : "";
    canvas.dataset.visible = String(collection.features.length);
    canvas.dataset.pairs = collection.features.map((feature) => `${feature.properties.origin}|${feature.properties.destination}`).join(",");
    canvas.dataset.airports = airportsOnMap.features.map((feature) => feature.properties.iata).join(",");
    canvas.dataset.points = airportsOnMap.features.map((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      return `${feature.properties.iata}:${lat.toFixed(5)},${lon.toFixed(5)}`;
    }).join(";");
    canvas.dataset.screen = map ? airportsOnMap.features.map((feature) => {
      const point = map.project(feature.geometry.coordinates);
      return `${feature.properties.iata}:${Math.round(point.x)},${Math.round(point.y)}`;
    }).join(";") : "";
    if (map && collection.features.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const feature of collection.features) {
        for (const coord of feature.geometry.coordinates) {
          const point = map.project(coord);
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
      canvas.dataset.arcBox = [minX, minY, maxX, maxY].map((value) => Math.round(value)).join(",");
    } else {
      canvas.dataset.arcBox = "";
    }
  }
  syncNetworkToggle();
}

function savedDestinations(code) {
  const date = form.elements.date.value;
  const found = new Set();
  for (const flight of schedule?.flights ?? []) {
    if (flight.origin === code && flight.date === date) found.add(flight.destination);
  }
  return [...found].sort();
}

function hopDistance(starts, reverse) {
  const dist = new Map();
  const queue = [];
  for (const code of starts) {
    if (dist.has(code)) continue;
    dist.set(code, 0);
    queue.push(code);
  }
  while (queue.length) {
    const code = queue.shift();
    const nextHop = dist.get(code) + 1;
    for (const next of (reverse ? inbound : outbound).get(code) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, nextHop);
      queue.push(next);
    }
  }
  return dist;
}

function publishedTripSegments(origins, destinations, maxStops) {
  const maxHops = maxStops + 1;
  const destSet = new Set(destinations);
  const toDest = hopDistance(destinations, true);
  const segments = new Set();
  const direct = new Set();
  for (const origin of origins) {
    const stack = [{ airport: origin, hops: 0, seen: new Set([origin]), path: [] }];
    while (stack.length) {
      const current = stack.pop();
      if (current.hops >= maxHops) continue;
      for (const next of outbound.get(current.airport) ?? []) {
        if (current.seen.has(next)) continue;
        const arrive = current.hops + 1;
        const remain = toDest.get(next);
        if (remain === undefined || arrive + remain > maxHops) continue;
        const edge = `${current.airport}|${next}`;
        if (destSet.has(next)) {
          for (const earlier of current.path) segments.add(earlier);
          segments.add(edge);
          if (arrive === 1) direct.add(edge);
          continue;
        }
        if (arrive >= maxHops) continue;
        const seen = new Set(current.seen);
        seen.add(next);
        stack.push({ airport: next, hops: arrive, seen, path: current.path.concat(edge) });
      }
    }
  }
  return { segments, direct };
}

function cameraPadding() {
  const gap = 24;
  const frame = document.querySelector("#map").getBoundingClientRect();
  const sheet = document.querySelector(".sheet")?.getBoundingClientRect();
  const dock = document.querySelector(".dock")?.getBoundingClientRect();
  const zoom = document.querySelector(".maplibregl-ctrl-top-right")?.getBoundingClientRect();
  const attrib = document.querySelector(".maplibregl-ctrl-bottom-right")?.getBoundingClientRect();
  const narrow = frame.width <= 800;
  const padding = narrow
    ? {
        top: Math.max(48, dock && dock.height > 0 ? dock.bottom - frame.top + gap : 0, zoom ? zoom.bottom - frame.top + 8 : 0),
        right: 20,
        bottom: Math.max(24, sheet && sheet.height > 0 ? frame.bottom - sheet.top + gap : 0),
        left: 16,
      }
    : {
        top: Math.max(36, zoom && zoom.height > 0 ? zoom.height + 12 : 0),
        right: Math.max(48, dock && dock.width > 0 ? frame.right - dock.left + gap : 0, zoom && zoom.width > 0 ? frame.right - zoom.left + 12 : 0),
        bottom: Math.max(28, attrib && attrib.height > 0 ? frame.bottom - attrib.top + 8 : 0),
        left: Math.max(48, sheet && sheet.width > 0 ? sheet.right - frame.left + gap : 0),
      };
  const minSpan = 96;
  if (padding.left + padding.right > frame.width - minSpan) {
    const scale = (frame.width - minSpan) / Math.max(padding.left + padding.right, 1);
    padding.left = Math.round(padding.left * scale);
    padding.right = Math.round(padding.right * scale);
  }
  if (padding.top + padding.bottom > frame.height - minSpan) {
    const scale = (frame.height - minSpan) / Math.max(padding.top + padding.bottom, 1);
    padding.top = Math.round(padding.top * scale);
    padding.bottom = Math.round(padding.bottom * scale);
  }
  return padding;
}

function geographicBounds(points) {
  const lons = points.map((point) => point[0]).sort((left, right) => left - right);
  const median = lons[Math.floor(lons.length / 2)] ?? 0;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    let shifted = lon;
    while (shifted - median > 180) shifted -= 360;
    while (median - shifted > 180) shifted += 360;
    minLon = Math.min(minLon, shifted);
    maxLon = Math.max(maxLon, shifted);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const lonPad = Math.max((maxLon - minLon) * 0.04, 0.4);
  const latPad = Math.max((maxLat - minLat) * 0.04, 0.3);
  return [[minLon - lonPad, minLat - latPad], [maxLon + lonPad, maxLat + latPad]];
}

function fitCurrentRoutes() {
  if (!map) return;
  const points = [];
  for (const feature of routeCollection().features) {
    for (const coord of feature.geometry.coordinates) points.push(coord);
  }
  if (!points.length) {
    for (const code of [...readEndpoint("from").codes, ...readEndpoint("to").codes]) {
      const airport = airports.get(code);
      if (airport) points.push([airport.lon, airport.lat]);
    }
  }
  if (!points.length) return;
  map.fitBounds(geographicBounds(points), { padding: cameraPadding(), duration: 450 });
}

function publishedDates() {
  return [...new Set((schedule?.flights ?? []).map((flight) => flight.date))].sort();
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

function hubsIn(itineraries) {
  const found = new Set();
  for (const itinerary of itineraries) {
    for (const connection of itinerary.connections) found.add(connection.airport);
  }
  return [...found].sort();
}

function readFilterQuery() {
  const duration = Number(form.elements.duration.value);
  const layover = Number(form.elements.layover.value);
  return {
    maxElapsedMinutes: duration > 0 ? duration : null,
    departureWindow: form.elements.depart.value || null,
    arrivalWindow: form.elements.arrive.value || null,
    connectingAirport: resolveHub(form.elements.hub.value) || null,
    maxLayoverMinutes: layover > 0 ? layover : null,
  };
}

function resolveHub(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "any") return "";
  const code = trimmed.toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) return code;
  const query = trimmed.toLowerCase();
  const hits = connectionHubs.filter((hub) => {
    const airport = airports.get(hub);
    return airport?.city.toLowerCase() === query || airportPlace(hub).toLowerCase() === query;
  });
  return hits.length === 1 ? hits[0] : "";
}

function renderHubSuggest() {
  const list = document.querySelector("#hub-list");
  const query = form.elements.hub.value.trim().toLowerCase();
  const items = connectionHubs.filter((code) => {
    if (!query) return true;
    const airport = airports.get(code);
    return code.toLowerCase().startsWith(query) || (airport?.city.toLowerCase().startsWith(query) ?? false);
  });
  list.replaceChildren();
  if (!items.length || document.activeElement !== form.elements.hub) {
    list.hidden = true;
    return;
  }
  for (const code of items) {
    const entry = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = airportPlace(code);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      form.elements.hub.value = code;
      list.hidden = true;
      search();
    });
    entry.append(button);
    list.append(entry);
  }
  list.hidden = false;
}

function durationPhrase() {
  const value = form.elements.duration.value;
  if (value === "300") return "Under 5 hours";
  if (value === "480") return "Under 8 hours";
  if (value === "720") return "Under 12 hours";
  return "Duration";
}

function filterEmptyMessage(hidden, title, date) {
  const names = [];
  if (hidden.duration) names.push(durationPhrase());
  if (hidden.departure) names.push("Departure time");
  if (hidden.arrival) names.push("Arrival time");
  if (hidden.connecting) names.push("Connecting airport");
  if (hidden.layover) names.push("Layover");
  const who = names.length ? names.join(" and ") : "Filters";
  const count = hidden.duration ? ` ${hidden.duration} hidden by the duration cap.` : "";
  return `${who} hid every saved itinerary for ${title} on ${date}.${count}`;
}

function filterHideNote(hidden) {
  const notes = [];
  if (hidden.duration) notes.push(`${hidden.duration} hidden by the duration cap`);
  if (hidden.departure) notes.push(`${hidden.departure} hidden by the departure window`);
  if (hidden.arrival) notes.push(`${hidden.arrival} hidden by the arrival window`);
  if (hidden.connecting) notes.push(`${hidden.connecting} hidden by the connecting airport`);
  if (hidden.layover) notes.push(`${hidden.layover} hidden by the layover cap`);
  return notes.length ? `${notes.join(". ")}.` : "";
}

function applySuggestion(name, item, runSearch = true) {
  const selection = item.kind === "group" ? groupSelection(item.group) : airportSelection(item.code, item.note);
  if (name === "from" && !toIsDestination(selection.codes)) {
    closeSuggest(name);
    if (selection.codes.length === 1) selectAirport(selection.codes[0]);
    else showOrigin(selection);
    return;
  }
  const previous = applyingField;
  applyingField = true;
  setEndpoint(name, selection);
  applyingField = previous;
  if (name === "from") originPick = selection.codes[0] ?? "";
  closeSuggest(name);
  if (runSearch && readEndpoint("from").codes.length && toIsDestination(readEndpoint("from").codes)) search();
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
      button.append(airportPlace(item.code));
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
  if (name === "from" && !toIsDestination(selection.codes)) {
    closeSuggest(name);
    if (selection.codes.length === 1) selectAirport(selection.codes[0]);
    else showOrigin(selection);
    return;
  }
  const previous = applyingField;
  applyingField = true;
  setEndpoint(name, selection);
  applyingField = previous;
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
  if (selection.label && !selection.label.includes("·") && selection.codes.length !== 1) return selection.label;
  if (selection.codes.length === 1) return airportPlace(selection.codes[0]);
  return selection.codes.map((code) => airportPlace(code)).join(", ");
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
  return { label: airportPlace(code), codes: [code], notes };
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

function airportPlace(code) {
  const airport = airports.get(code);
  if (!airport) return code;
  if (airport.city === "New York") {
    const short = airport.name.replace(/ International Airport$/, "").replace(/ Airport$/, "");
    return `${code} ${short}`;
  }
  return `${code} ${airport.city}`;
}

function pressStarts() {
  const from = readEndpoint("from");
  for (const button of document.querySelectorAll("[data-origin]")) {
    button.setAttribute("aria-pressed", from.codes.length === 1 && button.dataset.origin === from.codes[0] ? "true" : "false");
  }
  document.querySelector("#new-york").setAttribute("aria-pressed", readEndpoint("to").label === "New York" ? "true" : "false");
  syncClear();
}

function savedTripDates(origins, destinations, maxStops) {
  const hits = [];
  for (const date of publishedDates()) {
    let count = 0;
    let hidden = 0;
    for (const origin of origins) {
      const found = searchPublished(schedule.flights, {
        from: origin,
        to: destinations,
        date,
        stops: { nonstop: true, one: maxStops >= 1, two: maxStops >= 2 },
        excludeRedEyes: form.elements.redeye.checked,
      });
      count += filterItineraries(found.itineraries, readFilterQuery()).itineraries.length;
      hidden += found.hiddenRedEyes;
    }
    if (count > 0 || hidden > 0) hits.push({ date, count, hidden });
  }
  return hits;
}

function showDateChoices(dates) {
  for (const hit of dates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.textContent = hit.count > 0
      ? `${hit.date} · ${hit.count} itinerar${hit.count === 1 ? "y" : "ies"}`
      : `${hit.date} · overnight flights`;
    button.addEventListener("click", () => {
      form.elements.date.value = hit.date;
      search();
    });
    results.append(button);
  }
}

function clearSearch() {
  const date = form.elements.date.value;
  const stops = form.elements.stops.value;
  const sort = form.elements.sort.value;
  const redeye = form.elements.redeye.checked;
  const duration = form.elements.duration.value;
  const depart = form.elements.depart.value;
  const arrive = form.elements.arrive.value;
  const layover = form.elements.layover.value;
  const hub = form.elements.hub.value;
  clearEndpoint("from");
  clearEndpoint("to");
  originPick = "";
  pathPairs = new Set();
  airportPairs = new Set();
  focusPairs = new Set();
  isolatePath = false;
  airportFocus = false;
  showNetwork = false;
  results.replaceChildren();
  showOvernight.hidden = true;
  airportCard.hidden = true;
  closeSuggest("from");
  closeSuggest("to");
  form.elements.date.value = date;
  form.elements.stops.value = stops;
  form.elements.sort.value = sort;
  form.elements.redeye.checked = redeye;
  form.elements.duration.value = duration;
  form.elements.depart.value = depart;
  form.elements.arrive.value = arrive;
  form.elements.layover.value = layover;
  form.elements.hub.value = hub;
  connectionHubs = [];
  syncFiltersToggle();
  pressStarts();
  paintRoutes();
  fitCurrentRoutes();
  const dates = publishedDates();
  status.textContent = openingStatus(dates);
}

function activeFilterCount() {
  let count = 0;
  if (form.elements.stops.value !== "2") count += 1;
  if (form.elements.duration.value) count += 1;
  if (form.elements.depart.value) count += 1;
  if (form.elements.arrive.value) count += 1;
  if (form.elements.layover.value) count += 1;
  const hub = form.elements.hub.value.trim();
  if (hub && hub.toLowerCase() !== "any") count += 1;
  return count;
}

function syncFiltersToggle() {
  const count = activeFilterCount();
  filtersToggle.textContent = count ? `Filters · ${count}` : "Filters";
  filtersToggle.setAttribute("aria-expanded", filtersPanel.hidden ? "false" : "true");
}

function setFiltersOpen(open) {
  filtersPanel.hidden = !open;
  if (!open) document.querySelector("#hub-list").hidden = true;
  syncFiltersToggle();
  if (open) filtersPanel.querySelector(".filters-bar")?.scrollIntoView({ block: "nearest" });
  else filtersToggle.scrollIntoView({ block: "nearest" });
}

function syncClear() {
  const from = form.elements.from;
  const to = form.elements.to;
  document.querySelector("#clear").hidden = !from.value.trim() && !to.value.trim();
}

function syncNetworkToggle() {
  const button = document.querySelector("#network-toggle");
  const from = readEndpoint("from");
  const to = readEndpoint("to");
  const searching = from.codes.length > 0 && to.codes.some((code) => !from.codes.includes(code));
  button.hidden = !searching;
  button.textContent = showNetwork ? "Hide network" : "Show network";
  button.setAttribute("aria-pressed", showNetwork ? "true" : "false");
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
