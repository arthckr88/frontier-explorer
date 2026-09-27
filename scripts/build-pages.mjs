import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { scanDirectory } from "./pages-secret-scan.mjs";

compile("../src/site/published-search.ts", "search.js");
compile("../src/site/view.ts", "view.js");
mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
copyFileSync(new URL("../site/index.html", import.meta.url), new URL("../dist/index.html", import.meta.url));
copyFileSync(new URL("../site/app.js", import.meta.url), new URL("../dist/app.js", import.meta.url));
copyFileSync(new URL("../site/styles.css", import.meta.url), new URL("../dist/styles.css", import.meta.url));
copyFileSync(new URL("../data/network.json", import.meta.url), new URL("../dist/network.json", import.meta.url));
copyFileSync(new URL("../data/route-changes.json", import.meta.url), new URL("../dist/route-changes.json", import.meta.url));
writeFileSync(new URL("../dist/airports.json", import.meta.url), JSON.stringify(publishedAirports()));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl.mjs", import.meta.url), new URL("../dist/maplibre-gl.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", import.meta.url), new URL("../dist/maplibre-gl-shared.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url), new URL("../dist/maplibre-gl-worker.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl.css", import.meta.url), new URL("../dist/maplibre-gl.css", import.meta.url));
copyFileSync(new URL("../dist/index.html", import.meta.url), new URL("../dist/404.html", import.meta.url));
assertNoCredentialMarkers();
console.log("Wrote dist/ for GitHub Pages.");

function assertNoCredentialMarkers() {
  const roots = ["../dist", "../site", "../public"].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
  const hits = roots.filter((root) => existsSync(root)).flatMap((root) => scanDirectory(root));
  if (hits.length === 0) return;
  const summary = hits.map((hit) => `${hit.file}: ${hit.markers.join(", ")}`).join("; ");
  throw new Error(`Pages build refused credential markers. ${summary}`);
}

function compile(relativePath, outName) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
  });
  mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../dist/${outName}`, import.meta.url), compiled.outputText);
}

function publishedAirports() {
  const network = JSON.parse(readFileSync(new URL("../data/network.json", import.meta.url), "utf8"));
  if (!Array.isArray(network.observations) || network.observations.length === 0) {
    throw new Error("data/network.json has no booking observations.");
  }
  const codes = new Set(["OAK", "SFO", "LAS", "LAX", "BUR", "SAN", "ONT", "SNA"]);
  for (const flight of network.observations) {
    codes.add(flight.origin);
    codes.add(flight.destination);
  }
  for (const check of network.checks ?? []) {
    codes.add(check.origin);
    codes.add(check.destination);
  }
  for (const summary of network.summaries ?? []) {
    codes.add(summary.origin);
    codes.add(summary.destination);
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
      timezone: airport.timezone,
    }));
}
