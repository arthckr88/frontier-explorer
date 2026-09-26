import { searchPublished } from "./search.js";

const form = document.querySelector("#search");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
let schedule = null;

load().catch((error) => {
  status.textContent = error instanceof Error ? error.message : "The published schedule did not load.";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const from = String(data.get("from") ?? "").trim().toUpperCase();
  const to = String(data.get("to") ?? "").trim().toUpperCase();
  const date = String(data.get("date") ?? "").trim();
  render(from, to, date);
});

async function load() {
  const response = await fetch("flights.json");
  if (!response.ok) throw new Error("The published schedule did not load.");
  schedule = await response.json();
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
  status.textContent = "Schedule loaded. Search does not contact Frontier.";
}

function render(from, to, date) {
  results.replaceChildren();
  if (!schedule) {
    status.textContent = "The published schedule is still loading.";
    return;
  }
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    status.textContent = "Enter two different airport codes and a date.";
    return;
  }
  const knownDates = new Set(schedule.flights.map((flight) => flight.date));
  if (!knownDates.has(date)) {
    status.textContent = `No published flights for ${date} yet. Dates are added by the schedule update, not by this search.`;
    return;
  }
  const found = searchPublished(schedule.flights, { from, to, date });
  if (found.length === 0) {
    status.textContent = `No stored flight for ${from} → ${to} on ${date}.`;
    return;
  }
  status.textContent = `${found.length} itinerar${found.length === 1 ? "y" : "ies"} for ${from} → ${to} on ${date}.`;
  for (const itinerary of found) {
    results.append(card(itinerary, date));
  }
}

function card(itinerary, date) {
  const article = document.createElement("article");
  article.className = "card";
  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(badge(itinerary.stops === 0 ? "Nonstop" : `${itinerary.stops} stop`, ""));
  if (itinerary.vegasOvernight) badges.append(badge("Overnight in Las Vegas", "vegas"));
  badges.append(badge(formatElapsed(itinerary.elapsedMinutes), ""));
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
  return article;
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
  const hour = hour24 % 12 || 12;
  return `${hour}:${match[2]} ${suffix}`;
}

function formatElapsed(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours <= 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
