# Frontier Route Explorer

A map-first viewer for Frontier Airlines routes that were actually returned by Frontier's public booking page. It does not sell tickets, store Frontier credentials, or invent routes, frequencies, passenger counts, or GoWild seat availability.

The live site is GitHub Pages. It reads `data/network.json`, which is normalized from booking observations in `data/flights.json`. A listed market is a candidate for the updater. It is not a nonstop, and the map does not draw it. A confirmed arc requires a timed, dated nonstop. Future-only service is drawn differently from near-term service. Historical-only flights stay in storage and are not drawn as current routes.

Coverage is per route and date: flight found, checked empty, blocked, or not checked yet. A checked-empty date is negative evidence for that date only. Blocked and unchecked are unknown. A gap after observed flights is a possible gap, not a discontinuation.

The interface is dark and technical: a charcoal map, a green accent, and thin route arcs. It opens on Oakland, San Francisco, Las Vegas, and Southern California. The full confirmed network is still available. Personal watches are a fixed list of priority pairs. There are no accounts.

## Live path

```
Frontier public booking observations
  → data/flights.json
  → data/network.json, data/route-summaries.json, data/route-changes.json
  → GitHub Pages
  → map and search
```

`.github/workflows/sync.yml` runs hourly (`17 * * * *`). It checks out the repo, installs dependencies, verifies a bounded set of Frontier booking dates, normalizes observations and route changes, checks integrity, runs tests, builds Pages, and commits the data artifacts when they changed. It does not call `POST /api/cron` and it does not call FlightAware. Concurrency stays at 4, and each run requests at most 20 dates. HTTP 406 is blocked, which means unknown, and is not stored as an empty check. The full booking.flyfrontier.com crawl is stopped. Booking checks are a secondary verification of the priority corridors only. Observations already collected stay in `data/flights.json`.

The verifier covers OAK, SFO, LAS, LAX, BUR, SNA, ONT, and SAN, both directions of OAK–LAS, SFO–LAS, LAS–LAX, LAS–BUR, SFO–LAX, OAK–LAX, SFO–BUR, OAK–BUR, SFO–ONT, OAK–ONT, SFO–SNA, and SAN–LAS. It does not assume those routes exist. It backfills holes between observed dates on those corridors. See `data/RETENTION.md` before letting `flights.json` grow.

## Local Frontier browser fares

`npm run frontier:browser -- --origin OAK --destination LAS --date 2026-09-28` opens headed Chrome on the public booking form, one route and one date. A fresh cache file is printed and Frontier is not opened again until it expires, or until `--force`. The queue command accepts at most five searches, waits 15 seconds between them, and stops if a search is blocked. It is not a crawl, and GitHub Actions does not run it. Pages does not launch a browser.

## Frontier availability API

`FrontierAvailabilityProvider` can ask Frontier's mobile availability endpoint for one origin, destination, and date. It runs on the server or at build time. It does not run in the browser, and it is not part of the hourly sync. An unauthenticated request for OAK→LAS on 2026-09-28 returned HTTP 406 with an empty body, so that call is `blocked` and supplied no fares. The provider does not copy subscription keys, device ids, or session headers from other projects, and it does not retry a rejection with a new identity. Pages build fails if those credential markers appear in `dist/`, `site/`, or `public/`.

## FlightAware published schedules

FlightAware is a pluggable `ScheduleProvider`. The first implementation is `FlightAwareScheduleProvider`. `FLIGHTAWARE_API_KEY` is read on the server or in a workflow. It is not written into client JS, git, generated Pages files, logs, or reports. There is no key in this repo yet, so the live import has not been run.

The cheap production plan uses AeroAPI `GET /schedules/{date_start}/{date_end}` filtered to airline `FFT`, one priority corridor, and `max_pages`. That endpoint is $0.020 per result set of up to 15 records (AeroAPI fee table, spec 4.17.1). The $0.005 airport and operator scheduled-flight endpoints only accept a start and end about two days ahead, so they cannot fill the 14-day window. `GET /operators/FFT` ($0.015) is the operator check and is expected to return ICAO `FFT` before any schedule query. A published FlightAware row is `flightaware_schedule` evidence. A Frontier booking row is `frontier_booking` verification. Newsroom text would be `frontier_newsroom` and is not a timed nonstop. If the two schedule sources disagree, both rows are kept and the disagreement is recorded. A blocked booking date stays blocked. A date FlightAware did not fully query stays unchecked. Absence from FlightAware is not a checked-empty booking result. A listed market still cannot draw an arc.

```bash
npm run schedules:frontier -- near
npm run schedules:frontier:full
```

Both commands dry-run unless `--import` is present. `--import` without `FLIGHTAWARE_API_KEY` exits before any request. Do not run `schedules:frontier:full` on a schedule. The weekly workflow `.github/workflows/flightaware-schedule.yml` dry-runs only. Defaults are near 14 days, planning 60, extended 180, and a manual full year. `FLIGHTAWARE_MAX_RUN_COST_USD` defaults to 4.00 and `FLIGHTAWARE_MAX_PAGES` defaults to 2. The near plan's maximum estimated cost is $0.975 (one operator lookup plus 24 corridor queries at 2 pages). Four weekly near imports stay under about $5. The hourly Pages sync does not call FlightAware.

Route changes compare the new snapshot with `data/route-summaries.json`. The event list in `data/route-changes.json` keeps at most 80 events and drops events older than 90 days. An unchanged snapshot does not emit events. Event types are new observation, schedule extended, more flights, fewer flights, possible gap, data blocked, and service reappeared.

`npm run build:pages` fails if `data/network.json` is missing, malformed, or out of date with `data/flights.json`, if a confirmed arc has no observation, if an arc comes only from a listed market, if a summary date has no observation, or if a timestamp is invalid. Partial coverage does not fail the build.

Local commands:

```bash
npm install
npm test
npm run normalize:network
npm run check:integrity
npm run build:pages
npx serve dist
```

Open the URL `serve` prints. `npm run update:published` asks Frontier's public booking page for the next bounded set of dates and rewrites `data/flights.json`. Run `npm run normalize:network` after it. `npm run dev` starts the Next.js app, which is not the Pages site.

A Next.js and Postgres app remains in this repo for reconciliation experiments. It is not what GitHub Pages runs, and production does not require Postgres.

## What a sync actually stores

Adapters only keep what a public source returned.

| Source | What it may write | What it will not write |
| --- | --- | --- |
| Frontier Newsroom tag feeds | Directional announcement rows parsed from “New service from” tables, plus a looser from/to sentence when a table is absent | A cartesian product of every IATA code mentioned in an article |
| `flights.flyfrontier.com` flights-from pages | IATA-coded marketed samples (`Oakland (OAK) … Las Vegas (LAS) … Departing …`) | SEO city lists or sitemap pairs as confirmed nonstops |
| Public booking search (`booking.flyfrontier.com` results HTML) | Nonstop F9 flights with number, local departure, and local arrival, for priority origins over a 7-day window | Connections, other carriers, or a network guessed from fare blurbs |
| Timetable API | Schedule snapshots, only when `TIMETABLE_API_URL` is set | Anything, when the variable is empty. The run is recorded as skipped |
| Airport press URLs | Announcements, only for URLs in `AIRPORT_PRESS_URLS` | A guessed press corpus |
| GoWild and Discount Den public pages | Sentences that match a booking window, the $0.01 base fare, a dated blackout, or an explicit do-not-stack line | Seat inventory, blackout dates that were not printed, or stacked fares |
| BTS international T-100 (`xgub-n9bw`, carrier F9, type Passengers) | Historical international passenger counts for the latest period the API returns | Domestic popularity. If `BTS_DOMESTIC_RESOURCE_URL` is empty, domestic popularity is unavailable, not zero |

A failed or skipped source does not delete observations already stored. Reconciliation rebuilds the current projection from observations. It does not drop a route because a later sync returned no rows for it.

Airport reference rows (IATA, name, city, coordinates, timezone) come from OurAirports plus OpenFlights timezones. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). That file is reference metadata, not a route network.

## Architecture

```
public sources
  → adapters (src/server/ingestion/sources)
  → raw observations, announcements, program rules, metrics
  → reconciliation (src/server/reconciliation)
  → route projection, snapshots, change events
  → App Router pages
```

That diagram is the Next.js app, not GitHub Pages. The Pages browser only reads the static booking artifact. The Next server syncs from the CLI or from `POST /api/cron` when that app is running.

- `src/app` — pages and the cron/admin endpoints
- `src/components` — shell, map, status badges
- `src/lib` — time, graph search, airport groups
- `src/server/db` — Drizzle schema, migrate, seed
- `src/server/ingestion` — HTTP client and source adapters
- `src/server/reconciliation` — status, confidence, diffs
- `src/server/jobs` — sync commands
- `src/server/queries` — read models for pages

There is no Prisma schema. PostgreSQL is the only database.

## Local setup

Docker is the documented database. This repository also runs against any Postgres 16 that matches `DATABASE_URL`.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:setup
npm run sync
npm run dev
```

`db:setup` applies `drizzle/` and seeds reference airports, metro groups, source rows, and personal preference defaults. It does not insert routes.

Open [http://localhost:3000](http://localhost:3000).

Other commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run sync:priority
npm run sync:schedules
npm run sync:announcements
npm run sync:programs
npm run reconcile
```

`npm run dev` and `npm start` serve the Next.js app from Postgres. They do not call Frontier and they are not the Pages site. `npm run update:published` is the Pages booking updater. `npm run sync:schedules` is the separate Postgres booking job. `POST /api/cron?job=schedules` runs that Postgres job only. `npm run sync` also runs priority pages, announcements, programs, popularity, then reconciliation for the Next app.

## Environment

See `.env.example`. The app boots with no paid key.

- `DATABASE_URL` — Postgres connection string
- `CRON_SECRET` — bearer token for `POST /api/cron`. Unset means the endpoint returns 401
- `ADMIN_SECRET` — `x-admin-secret` for `POST /api/admin/sync`. Unset means admin sync returns 503
- `TILE_STYLE_URL` — MapLibre style. Default is OpenFreeMap dark and needs no key
- `TIMETABLE_API_URL` / `TIMETABLE_API_KEY` — optional tier-3 timetable. The key is sent as `Authorization: Bearer` and is not written to the database
- `BTS_INTERNATIONAL_RESOURCE_URL` — public SODA resource, default `xgub-n9bw`
- `BTS_DOMESTIC_RESOURCE_URL` — optional. Leave empty if you do not have a public domestic segment resource
- `AIRPORT_PRESS_URLS` — comma-separated public press or RSS URLs
- Interval and threshold variables — documented in `.env.example`

Do not commit `.env`.

## Next.js app

The Next.js app is not the live site. `POST /api/cron` can run the Postgres jobs when `CRON_SECRET` is set. Nothing in `.github/workflows/sync.yml` calls that endpoint. Unset, the route returns 401.

`.github/workflows/ci.yml` runs typecheck, lint, unit tests, integrity, the Pages build, and `next build` without a database.

Newsroom announcements are parsed for the Next app only. They are not mixed into the Pages map. Showing them as a separate "Announced by Frontier" layer is follow-up work, not a claim that a route operates.

## Adding a source

1. Implement one of the source shapes in `src/server/ingestion/sources`. Return a `SourceRunResult`: observations on success, an error string on failure, and `observations: []` when there is nothing to add. Do not delete prior rows from the adapter.
2. Tag each observation with source name, URL, retrieval time, source type, external id, and tier.
3. Register the loader in `src/server/jobs/run.ts` and add a source seed in `src/server/preferences/defaults.ts`.
4. Cover the parser with a fixture test. Do not promote an SEO pair or a prose mention to a confirmed nonstop unless a schedule observation says so.

## Reconciliation

`npm run reconcile` reloads stored observations, derives one projection per directional pair, writes a snapshot and `route_changes` rows when the comparison emits an event, and replaces current `flight_instances` only when a schedule observation includes both local times. Raw observations stay.

Status and confidence rules are in [docs/ROUTE_STATUS.md](docs/ROUTE_STATUS.md). Connection search is in [docs/ITINERARY_ENGINE.md](docs/ITINERARY_ENGINE.md). Source notes are in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## GoWild

The GoWild page shows sentences retrieved from public Frontier pages, with the source URL and retrieval time. It separates these ideas:

- a route observation exists
- a scheduled flight exists
- a booking window may be open
- a seat is confirmed
- availability is unknown

This app does not call a GoWild inventory feed. If availability was not retrieved from an authorized source, the page says availability must be confirmed with Frontier. Discount Den is a separate fare mode and is not stacked on a GoWild fare. Planning still runs when no fare quote exists.

## Known limitations

- The public booking search covers flights that depart the priority airports. A connection whose second flight departs some other airport is not in this pull. `TIMETABLE_API_URL` remains an optional extra feed. Marketed fare blurbs stay unknown and are hidden on the map until you toggle them.
- Domestic BTS popularity is unavailable unless you set a public domestic resource. International counts are historical and labeled with the reporting period. They are not current demand and they are not drawn as the route network.
- Booking is a “Search on Frontier” link. Query parameters may be ignored by Frontier. The app does not purchase tickets.
- Preference edits are open in this personal version. Sync and other administrative actions require a secret.
- LAS → BUR is a possible gap when later checked dates returned no nonstop and the dates between were not all checked. That is not an end date.
- Frontier newsroom posts are not on the live map. A separate "Announced by Frontier" layer is follow-up work.
