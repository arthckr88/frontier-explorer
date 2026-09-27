import { readFileSync, writeFileSync } from "node:fs";

const START = "2026-09-27";
const INDEX = "https://2lnr.com/routes/airlines/f9";
const OUT = new URL("../data/upcoming.json", import.meta.url);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const airports = new Map(
  JSON.parse(readFileSync(new URL("../data/airports.json", import.meta.url), "utf8")).map((airport) => [airport.iata, airport]),
);

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function longDate(iso) {
  const [year, month, day] = iso.split("-");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[Number(month) - 1]} ${Number(day)}, ${year}`;
}

function zonedLocalToUtc(localIso, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localIso);
  if (!match || !timeZone) return "";
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let utc = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    const next = utc - (shown - desired);
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc).toISOString().replace(".000Z", "Z");
}

async function fetchText(url) {
  let last = "no response";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    if (response.ok) return response.text();
    last = `HTTP ${response.status}`;
    if (response.status !== 429 && response.status < 500) throw new Error(`${last} ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw new Error(`${last} ${url}`);
}

function routeSlugs(html) {
  return [...new Set([...html.matchAll(/href="\/routes\/([a-z]{3}-[a-z]{3})(?:#|\")/g)].map((match) => match[1]))].sort();
}

function parseDuration(value) {
  const match = String(value).match(/(\d+)h(?:\s*(\d+)m)?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

function parseRows(html, origin, destination) {
  const checked = html.match(/last checked against our schedule feed on ([A-Za-z]+ \d{1,2}, \d{4})/);
  const flights = [];
  const row = /<tr><td[^>]*><time datetime="(\d{4}-\d{2}-\d{2})">[^<]*<\/time><\/td><td[^>]*>([^<]+)<\/td><td>([^<]+)<\/td><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td>/g;
  for (const match of html.matchAll(row)) {
    const [, date, flightLabel, airline, departure, arrival, duration] = match;
    if (airline !== "Frontier Airlines") continue;
    const number = flightLabel.match(/^F9 (\d+)$/);
    if (!number || date < START) continue;
    if (!/^\d{2}:\d{2}$/.test(departure) || !/^\d{2}:\d{2}$/.test(arrival)) continue;
    const minutes = parseDuration(duration);
    let extraDays = arrival <= departure ? 1 : 0;
    if (minutes != null) {
      const [depHour, depMinute] = departure.split(":").map(Number);
      const [arrHour, arrMinute] = arrival.split(":").map(Number);
      const elapsed = (arrHour * 60 + arrMinute) - (depHour * 60 + depMinute) + extraDays * 1440;
      if (Math.abs(elapsed - minutes) > 90 && extraDays === 0 && minutes > elapsed + 600) extraDays = 1;
    }
    const departureLocal = `${date}T${departure}:00`;
    const arrivalLocal = `${addDays(date, extraDays)}T${arrival}:00`;
    const originAirport = airports.get(origin);
    const destinationAirport = airports.get(destination);
    if (!originAirport?.timezone || !destinationAirport?.timezone) continue;
    const departureUtc = zonedLocalToUtc(departureLocal, originAirport.timezone);
    const arrivalUtc = zonedLocalToUtc(arrivalLocal, destinationAirport.timezone);
    if (!departureUtc || !arrivalUtc || arrivalUtc <= departureUtc) continue;
    flights.push({
      origin,
      destination,
      flightNumber: number[1],
      date,
      departureLocal,
      arrivalLocal,
      departureUtc,
      arrivalUtc,
    });
  }
  return { checked: checked?.[1] ?? "", flights };
}

async function mapPool(items, limit, run) {
  let index = 0;
  async function worker() {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await run(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function main() {
  const indexHtml = await fetchText(INDEX);
  const slugs = routeSlugs(indexHtml);
  console.log(`F9 route pages ${slugs.length}`);
  const flights = [];
  const checkedDates = new Set();
  let failures = 0;
  await mapPool(slugs, 6, async (slug, index) => {
    const [origin, destination] = slug.toUpperCase().split("-");
    if (origin === destination) return;
    try {
      const html = await fetchText(`https://2lnr.com/routes/${slug}`);
      const parsed = parseRows(html, origin, destination);
      if (parsed.checked) checkedDates.add(parsed.checked);
      flights.push(...parsed.flights);
    } catch (error) {
      failures += 1;
      console.log(`fail ${slug} ${error instanceof Error ? error.message : error}`);
    }
    if (index % 40 === 0) console.log(`pages ${index + 1}/${slugs.length} flights ${flights.length}`);
  });
  const unique = [];
  const seen = new Set();
  for (const flight of flights) {
    const key = `${flight.origin}|${flight.destination}|${flight.date}|${flight.flightNumber}|${flight.departureLocal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(flight);
  }
  unique.sort((left, right) => left.date.localeCompare(right.date) || left.origin.localeCompare(right.origin) || left.destination.localeCompare(right.destination) || left.departureLocal.localeCompare(right.departureLocal));
  if (!unique.length) throw new Error("No upcoming Frontier departures were parsed.");
  const periodStart = unique[0].date;
  const periodEnd = unique.at(-1).date;
  if (periodStart < START) throw new Error(`Schedule starts before ${START}`);
  const checked = [...checkedDates].sort().at(-1) || "September 20, 2026";
  const sentence = `Upcoming Frontier nonstops are Frontier Airlines departures in the 2LNR schedule feed at 2lnr.com, checked ${checked}, from ${longDate(periodStart)} through ${longDate(periodEnd)}.`;
  const schedule = {
    sourceName: "the 2LNR schedule feed",
    sourceUrl: INDEX,
    periodStart,
    periodEnd,
    checked,
    sentence,
    flights: unique,
  };
  writeFileSync(OUT, `${JSON.stringify(schedule)}\n`);
  const pairs = new Set(unique.map((flight) => `${flight.origin}|${flight.destination}`));
  const mexico = unique.filter((flight) => airports.get(flight.origin)?.country === "MX" || airports.get(flight.destination)?.country === "MX");
  const mexicoPairs = new Set(mexico.map((flight) => `${flight.origin}|${flight.destination}`));
  const central = unique.filter((flight) => ["GT", "SV", "HN", "CR", "NI", "PA", "BZ"].includes(airports.get(flight.origin)?.country) || ["GT", "SV", "HN", "CR", "NI", "PA", "BZ"].includes(airports.get(flight.destination)?.country));
  const caribbean = unique.filter((flight) => ["PR", "VI", "DO", "JM", "BS", "AW", "SX"].includes(airports.get(flight.origin)?.country) || ["PR", "VI", "DO", "JM", "BS", "AW", "SX"].includes(airports.get(flight.destination)?.country));
  console.log(`Wrote ${unique.length} flights, ${pairs.size} pairs, failures ${failures}.`);
  console.log(`Mexico flights ${mexico.length}, pairs ${mexicoPairs.size}: ${[...mexicoPairs].sort().join(", ")}`);
  console.log(`Central America flights ${central.length}. Caribbean flights ${caribbean.length}.`);
  console.log(sentence);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
