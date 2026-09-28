# Frontier Route Explorer

Frontier Route Explorer is a static GitHub Pages site for Frontier's network. It does not sell tickets, use paid schedule data, or run a scheduled Frontier crawl. Search reads stored files. It does not launch a browser.

Three layers stay separate:

- An official direct route is an airport pair Frontier names on a public flights-from page. `npm run frontier:network` is local and manual. It reads the flights-from sitemap and those pages, writes `data/frontier-direct-routes.json`, leaves city-to-city pairs in `data/frontier-markets.json` as candidate markets, rebuilds `data/network.json`, and runs the integrity check. It does not fetch booking fares, crawl dates, or run in GitHub Actions. A candidate market is not a nonstop. A fare module that reports another page is read in a normal browser with Clear filter and Show more. A challenge stops that page. The importer does not copy an authorization header.
- A schedule observation is a dated nonstop already in `data/flights.json`. The map draws it only when that dated observation exists.
- A fare observation is a Standard, Discount Den, or GoWild price in `data/browser-fares.json` for one route and one date. A missing fare is not a missing route. Price history is append-only in `data/price-history.jsonl`.

`npm run normalize:network` composes `data/network.json` from the official routes plus observations, checks, summaries, and fares. Pages deploys from `main` only, through `.github/workflows/deploy.yml`. GitHub Actions does not call Frontier. There is no hourly crawl.

## Local commands

```bash
npm install
npm run frontier:network
npm run normalize:network
npm test
npm run check:integrity
npm run build:pages
npx serve dist
```

`npm run frontier:browser -- --origin DEN --destination MCO --date 2026-10-01` opens headed Chrome for one pair and one date. Any airport pair is accepted. It parses FlightData, keeps fares separate from the schedule, and appends price history. A fresh cache is not queried again. The queue waits 15 seconds and stops when Frontier blocks the search.

`npm run frontier:verify-network -- --date 2026-10-01 --limit 1 --official-only --unchecked-only` checks official directs only, one query at a time, and resumes at the next unchecked route. It is not a network-wide crawl.

Search on the Pages site does not run either command. Current frequency stays “Insufficient schedule coverage” unless dated coverage is broad enough. One captured date is not a weekly frequency. Historical DOT/BTS frequency and T-100 city pairs are labeled with their period. Passenger totals for July 2025 through June 2026 are loaded from US DOT T-100 Segment, and historical pairs do not create a current route. Source rules are in `docs/source-contract.md`. GitHub repos are schema research only: `docs/github-source-integration.md`.

`npm run dev` starts the Next.js app. That app is not the Pages site. Pages build fails if credential markers appear in the output.

A Next.js and Postgres app remains in this repo for reconciliation experiments. It is not what GitHub Pages runs, and production does not require Postgres.

## What a sync actually stores

Adapters only keep what a public source returned.

| Source | What it may write | What it will not write |
| --- | --- | --- |
| Frontier Newsroom tag feeds | Directional announcement rows parsed from “New service from” tables, plus a looser from/to sentence when a table is absent | A cartesian product of every IATA code mentioned in an article |
| `flights.flyfrontier.com` flights-from pages | IATA-coded marketed samples (`Oakland (OAK) … Las Vegas (LAS) … Departing …`) | SEO city lists or sitemap pairs as confirmed nonstops |
| Public booking search (`booking.flyfrontier.com` results HTML) | Nonstop F9 flights with number, local departure, and local arrival for the pair that was searched | Connections, other carriers, or a network guessed from fare blurbs |
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

`npm run dev` and `npm start` serve the Next.js app from Postgres. They do not call Frontier and they are not the Pages site. `npm run sync:schedules` is the separate Postgres booking job. `POST /api/cron?job=schedules` runs that Postgres job only when called with `CRON_SECRET`. No GitHub workflow calls it. `npm run sync` also runs priority pages, announcements, programs, popularity, then reconciliation for the Next app.

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

The Next.js app is not the live site. `POST /api/cron` can run the Postgres jobs when `CRON_SECRET` is set. No GitHub workflow calls that endpoint. Unset, the route returns 401.

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
