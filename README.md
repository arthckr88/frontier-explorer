# Frontier Route Explorer

A map-first viewer for the Frontier Airlines route network. It stores source observations, keeps history, and plans connections from scheduled times when a timetable is actually loaded. It does not sell tickets, store Frontier credentials, or invent routes, frequencies, passenger counts, or GoWild seat availability.

The interface is dark and technical: a charcoal map, a green accent, and thin route arcs. Personal travel preferences (home airports, red-eye exclusion, Las Vegas stopovers) are settings. They are not treated as facts about the airline.

## What a sync actually stores

Adapters only keep what a public source returned.

| Source | What it may write | What it will not write |
| --- | --- | --- |
| Frontier Newsroom tag feeds | Directional announcement rows parsed from “New service from” tables, plus a looser from/to sentence when a table is absent | A cartesian product of every IATA code mentioned in an article |
| `flights.flyfrontier.com` flights-from pages | IATA-coded marketed samples (`Oakland (OAK) … Las Vegas (LAS) … Departing …`) | SEO city lists or sitemap pairs as confirmed nonstops |
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

The browser never syncs the network. Sync runs from the CLI or from `POST /api/cron`.

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

`npm run sync` runs priority pages, schedules, announcements, programs, popularity, then reconciliation.

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

## Cron and deploy

`POST /api/cron` with `Authorization: Bearer $CRON_SECRET` runs jobs that are due. Default cadence:

- Priority airports (OAK, SFO, LAS, LAX, BUR, JFK, LGA, MCO, FLL, MIA, plus saved-route endpoints): every 2 hours
- Network schedule: every 6 hours
- Announcements: every 2 hours
- Programs and full reconciliation: daily
- BTS popularity: every 30 days

`.github/workflows/sync.yml` calls that endpoint hourly and exits cleanly when `CRON_URL` or `CRON_SECRET` is not configured. Point `CRON_URL` at the deployed origin, without a trailing path. The workflow appends `/api/cron`.

A straightforward deploy is:

1. Provision Postgres and set `DATABASE_URL`.
2. Set `CRON_SECRET` and `ADMIN_SECRET`.
3. Build with `npm run build` and start with `npm start` (or a Node host that runs the Next.js server).
4. Run `npm run db:setup` once against that database.
5. Run `npm run sync` once, or let the GitHub Action call `/api/cron`.
6. Leave `TILE_STYLE_URL` on the OpenFreeMap default unless you have another legal style.

`.github/workflows/ci.yml` runs typecheck, lint, unit tests, and `next build` without a database. Pages are dynamic, so the production build does not need Postgres.

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

- No public Frontier timetable is called. Without `TIMETABLE_API_URL`, there are no timed itineraries, no departures-per-week rankings, and no green “active” arcs. Announced newsroom rows can still appear as announced, and marketed samples stay in the database with status unknown. The map hides unknown and ended routes until you toggle them.
- Domestic BTS popularity is unavailable unless you set a public domestic resource. International counts are historical and labeled with the reporting period. They are not current demand and they are not drawn as the route network.
- Booking is a “Search on Frontier” link. Query parameters may be ignored by Frontier. The app does not purchase tickets.
- Preference edits are open in this personal version. Sync and other administrative actions require a secret.
- LAS → BUR is a saved watch note. The note is not an end date and not evidence of service.
