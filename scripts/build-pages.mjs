import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import esbuild from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { scanDirectory } from "./pages-secret-scan.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/gh-pages/main.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/app.js",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [aliasPlugin()],
  loader: { ".css": "css" },
  legalComments: "none",
});

const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const processed = await postcss([tailwind()]).process(css, { from: path.join(root, "src/app/globals.css") });
writeFileSync(path.join(dist, "styles.css"), processed.css);

copyFileSync(path.join(root, "data/airport-departures.json"), path.join(dist, "airport-departures.json"));
copyFileSync(path.join(root, "data/network.json"), path.join(dist, "network.json"));
copyFileSync(path.join(root, "data/browser-fares.json"), path.join(dist, "browser-fares.json"));
copyFileSync(path.join(root, "data/route-changes.json"), path.join(dist, "route-changes.json"));
copyFileSync(path.join(root, "data/price-history.jsonl"), path.join(dist, "price-history.jsonl"));
copyFileSync(path.join(root, "data/historical-metrics.json"), path.join(dist, "historical-metrics.json"));
writeFileSync(path.join(dist, "airports.json"), JSON.stringify(publishedAirports()));
copyFileSync(path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"), path.join(dist, "maplibre-gl-worker.mjs"));
copyFileSync(path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs"), path.join(dist, "maplibre-gl-shared.mjs"));

const version = createHash("sha256").update(readFileSync(path.join(dist, "app.js"))).update(readFileSync(path.join(dist, "network.json"))).update(readFileSync(path.join(dist, "airport-departures.json"))).digest("hex").slice(0, 12);
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Frontier Route Explorer</title>
    <link rel="stylesheet" href="styles.css?v=${version}" />
    <link rel="stylesheet" href="app.css?v=${version}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="app.js?v=${version}"></script>
    <noscript>The map and search need JavaScript.</noscript>
  </body>
</html>
`;
writeFileSync(path.join(dist, "index.html"), html);
copyFileSync(path.join(dist, "index.html"), path.join(dist, "404.html"));
assertNoCredentialMarkers();
console.log("Wrote dist/ for GitHub Pages.");

function aliasPlugin() {
  return {
    name: "at-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const base = path.join(root, "src", args.path.slice(2));
        const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.css`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
        const found = candidates.find((candidate) => existsSync(candidate));
        if (!found) return { errors: [{ text: `Cannot resolve ${args.path}` }] };
        return { path: found };
      });
    },
  };
}

function assertNoCredentialMarkers() {
  const roots = [dist, path.join(root, "public")].filter((directory) => existsSync(directory));
  const hits = roots.flatMap((directory) => scanDirectory(directory));
  if (hits.length === 0) return;
  const summary = hits.map((hit) => `${hit.file}: ${hit.markers.join(", ")}`).join("; ");
  throw new Error(`Pages build refused credential markers. ${summary}`);
}

function publishedAirports() {
  const network = JSON.parse(readFileSync(path.join(root, "data/network.json"), "utf8"));
  if (!Array.isArray(network.observations) || network.observations.length === 0) {
    throw new Error("data/network.json has no booking observations.");
  }
  const codes = new Set();
  for (const code of network.official?.airports ?? []) codes.add(code);
  for (const route of network.official?.routes ?? []) {
    codes.add(route.origin);
    codes.add(route.destination);
  }
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
  for (const fare of network.fares ?? []) {
    codes.add(fare.origin);
    codes.add(fare.destination);
  }
  const airports = JSON.parse(readFileSync(path.join(root, "data/airports.json"), "utf8"));
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
      region: airport.region ?? "other",
    }));
}
