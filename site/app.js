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
let operatingDays = null;
let calendarMonth = "";
let calendarRoute = "";
const routeCache = new Map();
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

document.querySelector("#cal-prev").addEventListener("click", () => stepCalendar(-1));
document.querySelector("#cal-next").addEventListener("click", () => stepCalendar(1));

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

function onSearchControlChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.name === "from-region" || target.name === "to-region") {
    showRegion();
    return;
  }
  if (target.name === "stops" && !tripSelected()) {
    if (readEndpoint("from").codes.length) showSelectedAirport();
    else if (readEndpoint("to").codes.length) showArrivals();
    return;
  }
  if (target.name === "redeye" || target.name === "stops" || target.name === "sort" || target.name === "date" || target.name === "duration" || target.name === "depart" || target.name === "arrive" || target.name === "layover") search();
}

form.addEventListener("change", onSearchControlChange);
document.querySelector(".map-tools").addEventListener("change", onSearchControlChange);

const hubInput = form.elements.hub;
hubInput.addEventListener("input", () => {
  renderHubSuggest();
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
    if (!input.value.trim()) refreshEndpoints();
  });
  input.addEventListener("focus", () => renderSuggest(name));
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      closeSuggest(name);
      if (applyingField || document.activeElement === input) return;
      if (!input.value.trim()) {
        refreshEndpoints();
        return;
      }
      if (input.value.trim() === input.dataset.label && input.dataset.codes) return;
      const selection = completionSelection(input.value) ?? exactCodeSelection(input.value);
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
  const [upcomingResponse, airportResponse] = await Promise.all([
    fetch("upcoming.json"),
    fetch("airports.json"),
  ]);
  if (!upcomingResponse.ok) throw new Error("The upcoming schedule did not load.");
  if (!airportResponse.ok) throw new Error("The airport map did not load.");
  schedule = await upcomingResponse.json();
  schedule.flights ??= [];
  operatingDays = indexUpcoming(schedule);
  airports = new Map((await airportResponse.json()).map((airport) => [airport.iata, airport]));
  arcs = buildArcs();
  const dates = publishedDates();
  if (!form.elements.date.value) {
    const today = new Date().toISOString().slice(0, 10);
    form.elements.date.value = dates.find((date) => date >= today) ?? dates[dates.length - 1] ?? today;
  }
  if (network) network.textContent = describeNetwork();
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
  document.querySelector("#route-calendar").hidden = true;
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

function showArrivals() {
  document.querySelector("#route-calendar").hidden = true;
  const to = readEndpoint("to");
  if (!to.codes.length) return;
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
  for (const code of to.codes) {
    const routes = routesToAirport(code, Number.isFinite(maxStops) ? maxStops : 0);
    for (const segment of routes.segments) airportPairs.add(segment);
    for (const [origin, stops] of routes.reached) {
      const previous = reached.get(origin);
      if (previous === undefined || stops < previous) reached.set(origin, stops);
    }
  }
  originPick = to.codes[0] ?? "";
  pressStarts();
  if (to.codes.length === 1) showAirport(to.codes[0]);
  else airportCard.hidden = true;
  listReached(reached);
  status.textContent = arrivalStatus(to, reached, maxStops);
  paintRoutes();
  fitCurrentRoutes();
}

function showFullNetwork() {
  originPick = "";
  pathPairs = new Set();
  airportPairs = new Set();
  focusPairs = new Set();
  isolatePath = false;
  airportFocus = false;
  showNetwork = false;
  connectionHubs = [];
  results.replaceChildren();
  showOvernight.hidden = true;
  airportCard.hidden = true;
  closeSuggest("from");
  closeSuggest("to");
  document.querySelector("#route-calendar").hidden = true;
  pressStarts();
  if (network) network.textContent = describeNetwork();
  status.textContent = openingStatus(publishedDates());
  paintRoutes();
  fitCurrentRoutes();
}

function refreshEndpoints() {
  if (!schedule) return;
  const from = readEndpoint("from");
  const to = readEndpoint("to");
  const destinations = to.codes.filter((code) => !from.codes.includes(code));
  if (from.codes.length && destinations.length) {
    search();
    return;
  }
  if (from.codes.length) {
    showSelectedAirport();
    return;
  }
  if (to.codes.length) {
    showArrivals();
    return;
  }
  showFullNetwork();
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
  if (!from.codes.length) {
    if (to.codes.length) showArrivals();
    else showFullNetwork();
    return;
  }
  if (!destinations.length) {
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    status.textContent = "Enter a date.";
    document.querySelector("#route-calendar").hidden = true;
    paintRoutes();
    return;
  }
  const title = `${endTitle(from)} → ${endTitle(to)}`;
  const maxStops = Number(form.elements.stops.value);
  isolatePath = true;
  showNetwork = false;
  const published = publishedTripSegments(from.codes, destinations, maxStops);
  for (const segment of published.segments) pathPairs.add(segment);
  renderRouteCalendar();
  const datedFlights = schedule.flights;
  let hidden = 0;
  let itineraries = [];
  for (const origin of from.codes) {
    const found = searchPublished(datedFlights, {
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
    for (const segment of visible[0].segments) {
      const key = `${segment.origin}|${segment.destination}`;
      if (arcIndex.has(key)) pathPairs.add(key);
    }
  }
  const alternatives = savedTripDates(from.codes, destinations, maxStops).filter((hit) => hit.date !== date);
  if (visible.length === 0) {
    if (!published.direct.size) {
      status.textContent = `${title}. ${noDatedNonstopSentence()}`;
      if (published.segments.size) status.textContent += " Dated connections within this stops limit are on the map.";
    } else if (itineraries.length > 0) status.textContent = filterEmptyMessage(filtered.hidden, title, date);
    else if (hidden > 0) status.textContent = `No daytime itinerary for ${title} on ${date}.`;
    else status.textContent = `${title}. No departure on ${date}. Operating days are marked on the calendar.`;
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
  if (!published.direct.size) status.textContent += ` ${noDatedNonstopSentence()}`;
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
    return `${place}. No dated Frontier nonstop from this airport is in the on-time file.${savedNote}`;
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

function savedOrigins(code) {
  const date = form.elements.date.value;
  const found = new Set();
  for (const flight of schedule?.flights ?? []) {
    if (flight.destination === code && flight.date === date) found.add(flight.origin);
  }
  return [...found].sort();
}

function arrivalStatus(to, reached, maxStops) {
  const place = to.codes.length === 1 ? airportPlace(to.codes[0]) : endTitle(to);
  const groups = [[], [], []];
  for (const [code, stops] of reached) groups[Math.min(stops, 2)].push(code);
  const saved = [...new Set(to.codes.flatMap((code) => savedOrigins(code)))].sort();
  const savedNote = saved.length ? ` Saved flight times from ${saved.map(airportPlace).join(", ")}.` : "";
  if (!reached.size) {
    return `${place}. No dated Frontier nonstop into this airport is in the on-time file.${savedNote}`;
  }
  const nonstopNames = groups[0].map(airportPlace).sort((left, right) => left.localeCompare(right));
  const nonstopText = nonstopNames.length <= 8 ? nonstopNames.join(", ") : `${nonstopNames.length} airports`;
  if (maxStops === 0) return `${place}. Nonstop from ${nonstopText}.${savedNote}`;
  const limit = `Up to ${maxStops} stop${maxStops === 1 ? "" : "s"}`;
  let text = `${place}. ${limit}. Nonstop from ${nonstopText}.`;
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
  const inbound = airportFocus && !readEndpoint("from").codes.length && readEndpoint("to").codes.includes(code);
  const reached = (inbound ? routesToAirport : routesFromAirport)(code, Number.isFinite(maxStops) ? maxStops : 0).reached;
  airportCard.hidden = false;
  airportCard.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = airport.iata;
  const placeName = document.createElement("p");
  placeName.textContent = `${airport.city} · ${airport.name}`;
  const label = document.createElement("p");
  label.textContent = inbound ? arrivalSummary(reached, maxStops) : reachSummary(reached, maxStops);
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
  for (const key of Object.keys(operatingDays?.daily?.flights ?? {})) {
    const [origin, destination] = key.split("|");
    const pair = { origin, destination };
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

function routesToAirport(code, maxStops) {
  const cacheKey = `to|${code}|${maxStops}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;
  const maxHops = maxStops + 1;
  const segments = new Set();
  const reached = new Map();
  const stack = [{ airport: code, hops: 0, seen: new Set([code]) }];
  while (stack.length) {
    const current = stack.pop();
    if (current.hops >= maxHops) continue;
    for (const prev of inbound.get(current.airport) ?? []) {
      if (current.seen.has(prev)) continue;
      const edge = `${prev}|${current.airport}`;
      if (!arcIndex.has(edge)) continue;
      segments.add(edge);
      const stops = current.hops;
      const previous = reached.get(prev);
      if (previous === undefined || stops < previous) reached.set(prev, stops);
      const seen = new Set(current.seen);
      seen.add(prev);
      stack.push({ airport: prev, hops: current.hops + 1, seen });
    }
  }
  const result = { segments, reached };
  routeCache.set(cacheKey, result);
  return result;
}

function reachSummary(reached, maxStops) {
  if (!reached.size) return "No dated Frontier nonstop from this airport.";
  if (maxStops === 0) {
    const names = [...reached.keys()].map(airportPlace).sort((left, right) => left.localeCompare(right));
    if (names.length === 1) return `Nonstop to ${names[0]}.`;
    return `${names.length} nonstop destinations.`;
  }
  return `${reached.size} place${reached.size === 1 ? "" : "s"} within ${maxStops} stop${maxStops === 1 ? "" : "s"}.`;
}

function arrivalSummary(reached, maxStops) {
  if (!reached.size) return "No dated Frontier nonstop into this airport.";
  if (maxStops === 0) {
    const names = [...reached.keys()].map(airportPlace).sort((left, right) => left.localeCompare(right));
    if (names.length === 1) return `Nonstop from ${names[0]}.`;
    return `${names.length} nonstop origins.`;
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

function nonstopCodes() {
  const codes = new Set();
  for (const arc of visibleArcs()) {
    codes.add(arc.origin);
    codes.add(arc.destination);
  }
  if (showNetwork) {
    for (const key of pathKeys()) {
      const [origin, destination] = key.split("|");
      codes.add(origin);
      codes.add(destination);
    }
  }
  return codes;
}

function nonstopPairCount() {
  return arcs.length;
}

const FLORIDA = new Set(["FLL", "JAX", "MCO", "MIA", "PBI", "PNS", "RSW", "SRQ", "TPA"]);
const NORTHEAST = new Set(["BDL", "BOS", "BTV", "BUF", "EWR", "ISP", "JFK", "LGA", "MDT", "PHL", "PIT", "PWM", "SYR", "TTN"]);
const MIDWEST = new Set(["CID", "CLE", "CMH", "DSM", "DTW", "FAR", "FSD", "GRB", "GRR", "IND", "MCI", "MDW", "MKE", "MSN", "MSP", "OMA", "ORD", "STL"]);
const WEST = new Set(["BOI", "BUR", "DEN", "GEG", "LAS", "LAX", "MSO", "ONT", "PAE", "PDX", "PHX", "PSP", "RNO", "SAN", "SEA", "SFO", "SJC", "SLC", "SMF", "SNA", "TUS"]);
const SOUTH = new Set(["ATL", "AUS", "BNA", "BWI", "CHS", "CLT", "CRP", "CVG", "DCA", "DFW", "ELP", "IAD", "IAH", "LIT", "MEM", "MSY", "MYR", "OKC", "ORF", "RDU", "RIC", "SAT", "SAV", "TUL", "TYS", "XNA"]);
const CENTRAL_AMERICA = new Set(["GT", "SV", "HN", "CR", "NI", "PA", "BZ"]);
const CARIBBEAN = new Set(["PR", "VI", "DO", "JM", "BS", "AW", "AG", "TC", "SX", "CU", "HT", "TT", "BB", "GP", "MQ", "LC", "GD", "KY", "CW", "BQ", "KN", "DM", "VG", "MF", "BL", "AI", "MS"]);
const US_PARTS = new Set(["west", "midwest", "south", "northeast", "florida"]);
const EAST_PARTS = new Set(["northeast", "south", "florida"]);

function primaryArea(code) {
  if (FLORIDA.has(code)) return "florida";
  if (NORTHEAST.has(code)) return "northeast";
  if (MIDWEST.has(code)) return "midwest";
  if (WEST.has(code)) return "west";
  if (SOUTH.has(code)) return "south";
  const airport = airports.get(code);
  if (!airport) return "";
  if (airport.country === "MX") return "mexico";
  if (CENTRAL_AMERICA.has(airport.country)) return "central_america";
  if (CARIBBEAN.has(airport.country)) return "caribbean";
  if (airport.country === "US") return usAreaFromCoordinates(airport);
  return "";
}

function usAreaFromCoordinates(airport) {
  const { lat, lon } = airport;
  if (lat < 31.1 && lon > -88 && lon < -79.5) return "florida";
  if (lon <= -104) return "west";
  if (lat >= 39.5 && lon >= -80.5) return "northeast";
  if (lat >= 37 && lon <= -84) return "midwest";
  return "south";
}

function indexUpcoming(published) {
  const flights = {};
  for (const flight of published.flights ?? []) {
    if (!flight?.origin || !flight?.destination || !flight?.date || flight.date < "2026-09-27") continue;
    const key = `${flight.origin}|${flight.destination}`;
    const departure = String(flight.departureLocal ?? "").slice(11, 16).replace(":", "");
    const arrival = String(flight.arrivalLocal ?? "").slice(11, 16).replace(":", "");
    const rolled = String(flight.arrivalLocal ?? "").slice(0, 10) > flight.date ? "1" : "0";
    const record = departure.length === 4 && arrival.length === 4
      ? `${flight.date}|${flight.flightNumber}|${departure}|${arrival}|${rolled}`
      : flight.date;
    (flights[key] ??= []).push(record);
  }
  return {
    daily: {
      flights,
      sentence: published.sentence ?? "",
      sourceName: published.sourceName ?? "Frontier public booking results",
      sourceUrl: published.sourceUrl ?? "https://booking.flyfrontier.com/",
      periodStart: published.periodStart,
      periodEnd: published.periodEnd,
    },
  };
}

function airportAreas(code) {
  const part = primaryArea(code);
  const areas = new Set();
  if (!part) return areas;
  areas.add(part);
  if (US_PARTS.has(part)) areas.add("united_states");
  if (EAST_PARTS.has(part)) areas.add("east");
  return areas;
}

function regionSelection() {
  return {
    from: form.elements["from-region"]?.value || "any",
    to: form.elements["to-region"]?.value || "any",
  };
}

function regionArcVisible(origin, destination, from, to) {
  if (from === "any" && to === "any") return true;
  const left = airportAreas(origin);
  const right = airportAreas(destination);
  if (from === "any") return left.has(to) || right.has(to);
  if (to === "any") return left.has(from) || right.has(from);
  if (from === to) return left.has(from) && right.has(to);
  return (left.has(from) && right.has(to)) || (left.has(to) && right.has(from));
}

function visibleArcs() {
  const { from, to } = regionSelection();
  if (from === "any" && to === "any") return arcs;
  return arcs.filter((arc) => regionArcVisible(arc.origin, arc.destination, from, to));
}

function networkIsShowing() {
  return showNetwork || (!airportFocus && !isolatePath);
}

function regionLabel(value) {
  const option = form.elements["from-region"]?.querySelector(`option[value="${value}"]`);
  return option?.textContent || value;
}

function sourceSpan() {
  const daily = operatingDays?.daily;
  if (!daily) return "";
  return ` in ${daily.sourceName} from ${formatLong(daily.periodStart)} through ${formatLong(daily.periodEnd)}`;
}

function sliceDescription() {
  const { from, to } = regionSelection();
  if (from === "any" && to === "any") return "";
  const count = visibleArcs().length;
  const noun = `${count.toLocaleString()} upcoming Frontier nonstop${count === 1 ? "" : "s"}`;
  const source = sourceSpan();
  if (from === "any" || to === "any") {
    const label = regionLabel(from === "any" ? to : from);
    return count
      ? `${label}: ${noun}${source} with at least one end in ${label}.`
      : `${label}: no upcoming Frontier nonstop${source} has an end in ${label}.`;
  }
  const left = regionLabel(from);
  const right = regionLabel(to);
  if (from === to) {
    return count
      ? `${left}: ${noun}${source} entirely inside ${left}.`
      : `${left}: no upcoming Frontier nonstop${source} is entirely inside ${left}.`;
  }
  return count
    ? `${left} → ${right}: ${noun}${source}, with one end in each region.`
    : `${left} → ${right}: no upcoming Frontier nonstop${source} has one end in each region.`;
}

function showRegion() {
  if (network) network.textContent = describeNetwork();
  if (!map || !networkIsShowing()) return;
  paintRoutes();
  fitCurrentRoutes();
}

function noDatedNonstopSentence() {
  const daily = operatingDays?.daily;
  if (!daily?.periodStart) return "No upcoming Frontier nonstop is in the published booking results.";
  return `No upcoming Frontier nonstop is in ${daily.sourceName} from ${formatLong(daily.periodStart)} through ${formatLong(daily.periodEnd)}.`;
}

function describeNetwork() {
  const slice = sliceDescription();
  if (slice) return slice;
  const daily = operatingDays?.daily;
  if (daily?.sentence) return daily.sentence;
  const pairs = nonstopPairCount();
  if (!pairs) return "No upcoming Frontier nonstop is on the map.";
  return `This map shows ${pairs.toLocaleString()} upcoming Frontier nonstop city pairs.`;
}

function openingStatus(dates) {
  if (!dates.length) return "No upcoming flight times are loaded.";
  return `Upcoming flight times run ${dates[0]} through ${dates[dates.length - 1]}.`;
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
    for (const arc of visibleArcs()) {
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
    if (!arcIndex.has(key)) continue;
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
    canvas.dataset.regionFrom = regionSelection().from;
    canvas.dataset.regionTo = regionSelection().to;
    const focusedCodes = readEndpoint("from").codes.length ? readEndpoint("from").codes : readEndpoint("to").codes;
    canvas.dataset.airport = airportFocus ? focusedCodes.join(",") : "";
    canvas.dataset.direction = airportFocus ? (readEndpoint("from").codes.length ? "outbound" : "inbound") : "";
    const areaCodes = new Set();
    for (const arc of arcs) {
      areaCodes.add(arc.origin);
      areaCodes.add(arc.destination);
    }
    canvas.dataset.areas = [...areaCodes].map((code) => `${code}:${primaryArea(code)}`).join(",");
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
  const tools = document.querySelector(".filter-row")?.getBoundingClientRect();
  const narrow = frame.width <= 800;
  const toolsTop = tools && tools.height > 0 ? tools.bottom - frame.top + 8 : 0;
  const padding = narrow
    ? {
        top: Math.max(48, dock && dock.height > 0 ? dock.bottom - frame.top + gap : 0, zoom ? zoom.bottom - frame.top + 8 : 0, toolsTop),
        right: 20,
        bottom: Math.max(24, sheet && sheet.height > 0 ? frame.bottom - sheet.top + gap : 0),
        left: 16,
      }
    : {
        top: Math.max(36, zoom && zoom.height > 0 ? zoom.height + 12 : 0, toolsTop),
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
  if (runSearch) search();
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

function exactCodeSelection(value) {
  const raw = value.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(raw) && airports.has(raw)) return airportSelection(raw);
  return null;
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
  form.elements.date.value = date;
  form.elements.stops.value = stops;
  form.elements.sort.value = sort;
  form.elements.redeye.checked = redeye;
  form.elements.duration.value = duration;
  form.elements.depart.value = depart;
  form.elements.arrive.value = arrive;
  form.elements.layover.value = layover;
  form.elements.hub.value = hub;
  showFullNetwork();
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

function stepCalendar(delta) {
  if (!calendarMonth) return;
  const coverage = routeCoverage(readEndpoint("from").codes, readEndpoint("to").codes.filter((code) => !readEndpoint("from").codes.includes(code)));
  const [minMonth, maxMonth] = calendarBounds(coverage);
  const next = shiftMonth(calendarMonth, delta);
  if (next < minMonth || next > maxMonth) return;
  calendarMonth = next;
  renderRouteCalendar();
}

function shiftMonth(month, delta) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month) {
  const [year, index] = month.split("-");
  return `${MONTH_NAMES[Number(index) - 1]} ${year}`;
}

function formatLong(iso) {
  const [year, month, day] = iso.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`;
}

function pairKeys(origins, destinations) {
  const keys = [];
  for (const origin of origins) {
    for (const destination of destinations) {
      if (origin !== destination) keys.push(`${origin}|${destination}`);
    }
  }
  return keys;
}

function routeCoverage(origins, destinations) {
  const keys = pairKeys(origins, destinations);
  const daily = operatingDays?.daily;
  const records = [];
  for (const key of keys) {
    for (const record of daily?.flights?.[key] ?? []) records.push(record);
  }
  const dailyDates = new Set(records.map((record) => record.slice(0, 10)));
  const kind = dailyDates.size ? "day" : "none";
  const sentence = dailyDates.size ? (daily?.sentence ?? "") : noDatedNonstopSentence();
  return { kind, sentence, records, dailyDates, savedDates: new Set(), months: [] };
}

function calendarBounds(coverage) {
  const daily = operatingDays?.daily;
  const monthly = operatingDays?.monthly;
  const marks = [...coverage.dailyDates, ...coverage.savedDates].map((date) => date.slice(0, 7)).sort();
  const start = coverage.kind === "month" ? monthly.periodStart : daily?.periodStart?.slice(0, 7);
  const end = coverage.kind === "month" ? monthly.periodEnd : daily?.periodEnd?.slice(0, 7);
  return [marks[0] && marks[0] < start ? marks[0] : start, marks.at(-1) && marks.at(-1) > end ? marks.at(-1) : end];
}

function renderRouteCalendar() {
  const box = document.querySelector("#route-calendar");
  const from = readEndpoint("from");
  const to = readEndpoint("to");
  const destinations = to.codes.filter((code) => !from.codes.includes(code));
  if (!operatingDays || !from.codes.length || !destinations.length) {
    box.hidden = true;
    return null;
  }
  const coverage = routeCoverage(from.codes, destinations);
  const routeKey = pairKeys(from.codes, destinations).join(",");
  const [minMonth, maxMonth] = calendarBounds(coverage);
  if (calendarRoute !== routeKey || !calendarMonth) {
    calendarRoute = routeKey;
    const selected = form.elements.date.value.slice(0, 7);
    const markedMonths = new Set([...coverage.dailyDates, ...coverage.savedDates].map((date) => date.slice(0, 7)));
    if (coverage.kind === "day" && markedMonths.has(selected)) calendarMonth = selected;
    else if (coverage.kind === "month") calendarMonth = coverage.months.at(-1);
    else if (markedMonths.size) calendarMonth = [...markedMonths].sort().at(-1);
    else calendarMonth = selected >= minMonth && selected <= maxMonth ? selected : maxMonth;
  }
  if (calendarMonth < minMonth) calendarMonth = minMonth;
  if (calendarMonth > maxMonth) calendarMonth = maxMonth;
  box.hidden = false;
  document.querySelector("#cal-label").textContent = formatMonth(calendarMonth);
  document.querySelector("#cal-prev").disabled = calendarMonth <= minMonth;
  document.querySelector("#cal-next").disabled = calendarMonth >= maxMonth;
  const months = document.querySelector("#cal-months");
  months.replaceChildren();
  if (coverage.kind === "month") {
    for (const month of monthsBetween(minMonth, maxMonth)) {
      const marked = coverage.months.includes(month);
      const chip = document.createElement(marked ? "button" : "span");
      chip.className = marked ? "cal-month is-on" : "cal-month";
      chip.textContent = `${MONTH_NAMES[Number(month.slice(5)) - 1].slice(0, 3)} ${month.slice(0, 4)}`;
      if (marked) {
        chip.type = "button";
        chip.dataset.month = month;
        chip.addEventListener("click", () => {
          calendarMonth = month;
          renderRouteCalendar();
        });
      }
      months.append(chip);
    }
  }
  const markedDays = coverage.kind === "day" ? new Set([...coverage.dailyDates, ...coverage.savedDates]) : new Set();
  renderDayGrid(calendarMonth, markedDays);
  const sourceLine = document.querySelector("#cal-source");
  if (sourceLine) sourceLine.textContent = coverage.sentence;
  box.dataset.kind = coverage.kind;
  box.dataset.months = coverage.months.join(",");
  box.dataset.marked = [...markedDays].sort().join(",");
  box.dataset.sentence = coverage.sentence;
  return coverage;
}

function monthsBetween(start, end) {
  const months = [];
  let cursor = start;
  while (cursor && end && cursor <= end) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}

function renderDayGrid(month, marked) {
  const grid = document.querySelector("#cal-grid");
  grid.replaceChildren();
  for (const label of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
    const cell = document.createElement("div");
    cell.className = "cal-dow";
    cell.textContent = label;
    grid.append(cell);
  }
  const [year, index] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  for (let pad = 0; pad < start; pad += 1) grid.append(document.createElement("span"));
  for (let day = 1; day <= days; day += 1) {
    const iso = `${month}-${String(day).padStart(2, "0")}`;
    if (marked.has(iso)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cal-day is-on";
      button.textContent = String(day);
      button.dataset.date = iso;
      button.addEventListener("click", () => {
        form.elements.date.value = iso;
        search();
      });
      grid.append(button);
    } else {
      const span = document.createElement("span");
      span.className = "cal-day";
      span.textContent = String(day);
      grid.append(span);
    }
  }
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
