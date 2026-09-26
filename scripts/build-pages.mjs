import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/site/published-search.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
  },
});
mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/search.js", import.meta.url), compiled.outputText);
copyFileSync(new URL("../site/index.html", import.meta.url), new URL("../dist/index.html", import.meta.url));
copyFileSync(new URL("../site/app.js", import.meta.url), new URL("../dist/app.js", import.meta.url));
copyFileSync(new URL("../site/styles.css", import.meta.url), new URL("../dist/styles.css", import.meta.url));
copyFileSync(new URL("../data/flights.json", import.meta.url), new URL("../dist/flights.json", import.meta.url));
writeFileSync(new URL("../dist/airports.json", import.meta.url), JSON.stringify(publishedAirports()));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl.mjs", import.meta.url), new URL("../dist/maplibre-gl.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", import.meta.url), new URL("../dist/maplibre-gl-shared.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url), new URL("../dist/maplibre-gl-worker.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl.css", import.meta.url), new URL("../dist/maplibre-gl.css", import.meta.url));
copyFileSync(new URL("../dist/index.html", import.meta.url), new URL("../dist/404.html", import.meta.url));
console.log("Wrote dist/ for GitHub Pages.");

function publishedAirports() {
  const flights = JSON.parse(readFileSync(new URL("../data/flights.json", import.meta.url), "utf8"));
  const codes = new Set();
  for (const flight of flights.flights ?? []) {
    codes.add(flight.origin);
    codes.add(flight.destination);
  }
  for (const route of flights.routes ?? []) {
    codes.add(route.origin);
    codes.add(route.destination);
  }
  const airports = JSON.parse(readFileSync(new URL("../data/airports.json", import.meta.url), "utf8"));
  return airports
    .filter((airport) => codes.has(airport.iata) && Number.isFinite(airport.lat) && Number.isFinite(airport.lon))
    .map((airport) => ({
      iata: airport.iata,
      name: airport.name,
      city: airport.city,
      country: airport.country,
      lat: airport.lat,
      lon: airport.lon,
    }));
}
