# Data sources

GitHub Pages reads Frontier public booking observations from `data/network.json`. That file is built from `data/flights.json`. Listed markets in the same raw file are candidates for the updater, not confirmed nonstops. `data/upcoming.json` is an old third-party sample and is not the live schedule. DOT history in `data/nonstops.json` and `data/operating-days.json` is not the current schedule. Pages does not ship those files.

Frontier booking is now a targeted verifier for OAK, SFO, LAS, LAX, BUR, SNA, ONT, SAN and the priority corridors in both directions. The full booking crawl is stopped. FlightAware published schedules are a separate source (`flightaware_schedule`) behind `FLIGHTAWARE_API_KEY`. That key is not in the client bundle. A FlightAware row does not erase a booking row. Blocked stays blocked. See the README for the dry-run command and the $0.975 near-plan cap.

Every network fact is an observation. An observation records the source id, display name, tier, kind, URL when one exists, retrieval time, external id, and the directional pair. Reconciliation may disagree with an observation. It does not rewrite it.

## Tiers

1. Frontier public pages and feeds: Newsroom, flights-from pages, GoWild, Discount Den.
2. Airport press releases listed in `AIRPORT_PRESS_URLS`. Empty means this tier is skipped.
3. A timetable URL you configure. The process skips it when `TIMETABLE_API_URL` is unset. The optional key is sent as a bearer token and is not stored.
4. U.S. DOT / BTS passenger statistics. Popularity is not frequency.

The production adapters do not log into a Frontier account or read Google Flights. `FrontierAvailabilityProvider` is a separate server-side proof of concept for Frontier's mobile availability endpoint. The unauthenticated OAK→LAS request was rejected with HTTP 406 and an empty body. That rejection is `blocked`. The provider is not on the Pages live path, and it does not use credentials copied from another project.

## Frontier Newsroom

Feeds:

- `https://news.flyfrontier.com/tagfeed/en-us/tags/news,national`
- `https://news.flyfrontier.com/tagfeed/en-us/tags/news,city`

`/feed` on the newsroom host has returned an empty body. The tag feeds are the ones the adapter requests.

The parser reads HTML tables that follow “New service from … (IATA)”. Each data row becomes one directional announcement: destination IATA, start date, and frequency text (`Daily`, `Nx/week`). If an item has no such table, a single “from (AAA) to (BBB)” sentence can become one announcement. Other IATA codes in the article are ignored.

Those rows are announcements. They become `ANNOUNCED` only when the parsed start date is still in the future and no schedule snapshot exists. They are not marked active. A start date that has already passed, with no schedule observation, is flagged `launchUnverified` instead of being treated as operating service.

Headlines are stored even when they do not name a pair, so the change and announcement lists can show the article. A headline alone is not a route.

## Flights-from pages

The adapter reads the public sitemap at `https://flights.flyfrontier.com/en/sitemap/flights-from-city/page-1` and then fetches pages for priority airports and saved-route endpoints. Priority airports are OAK, SFO, LAS, LAX, BUR, JFK, LGA, MCO, FLL, and MIA.

A marketed sample is an IATA-coded “Departing” snippet. City-name “more flights” lists are not pairs. A sample is stored as `marketed_sample` with unknown status. The default map filter does not draw unknown routes. The route page says a marketed date is not a timetable and not seat availability.

## Schedule

### Public booking search (tier 1)

The schedule adapter opens the same pages as the public booking form on `https://booking.flyfrontier.com/`. It does not call `/Flight/RetrieveSchedule`, `Resource/GetMarkets`, or any other JSON endpoint.

What a browser does, and what the adapter does:

1. `GET https://booking.flyfrontier.com/` returns the search page and the session cookies a browser gets before searching. The HTML includes each station’s `markets` list inside the public search config. Priority origins are OAK, SFO, LAS, LAX, BUR, JFK, LGA, MCO, FLL, and MIA. Destinations are only the markets that page lists for those origins.
2. `GET https://booking.flyfrontier.com/Flight/InternalSelect?o1={origin}&d1={destination}&dd1={date}&ADT=1&umnr=false&mon=true` is the search URL the public form builds (`searchUrl` in that page). It responds `302` to `/Flight/Select`. The request sends the homepage session cookie and ordinary document-navigation headers.
3. `GET https://booking.flyfrontier.com/Flight/Select` is the results document, requested with that same cookie and the InternalSelect URL as the referrer. A checked page contains a `FlightData = '...'` assignment. After HTML entities are decoded, `journeys[].flights[].legs[]` has `carrierCode`, `flightNumber`, `departureStation`, `arrivalStation`, `departureDate`, and `arrivalDate`. A response of HTTP 406 has an empty body and no flight times. The adapter discards that session, opens the homepage again, and retries. It does not store the 406 as an empty day.

A page checked on 2026-09-28 for OAK→LAS contained two nonstops in that assignment: F9 2046 departing 10:17 and arriving 11:58, and F9 3838 departing 18:51 and arriving 20:32, both local on that date. A connection (more than one leg) is not stored as a nonstop. A leg whose carrier is not `F9` is not stored. A page with no `FlightData` assignment is a failed check, not an empty schedule.

The updater asks for seven Denver-local dates starting today, so each weekday occurs once. A route that operates twice in that week shows two departures. Flights-from fare blurbs stay `marketed_sample` rows and are not promoted. `npm run sync:schedules` and `POST /api/cron?job=schedules` run this updater. Page renders do not. Each task is one origin, destination, and date, and up to `PUBLIC_SCHEDULE_CONCURRENCY` tasks run at once (default 4). Origins stay inside the priority list, or the `PUBLIC_SCHEDULE_ORIGINS` subset. A successful day is written to Postgres immediately. An HTTP 406 is recorded and that city pair is skipped with no pause chain. A results page is stored only when `originOne`, `destinationOne`, and `departureDateOne` match the search. Parsed days are cached for 12 hours in `source_cache`. A failed day is not treated as “no flight.”

`/system/data` shows this source as `frontier-public-schedule`. The optional timetable source stays separate.

### Optional timetable API (tier 3)

`src/server/ingestion/sources/schedule.ts` requests `TIMETABLE_API_URL` only when that variable is set. The payload is a JSON array of `{ origin, destination, date, departureLocal?, arrivalLocal?, flightNumber?, windowStart?, windowEnd? }`. Leaving the variable empty records `skipped` and does not delete observations. That feed is `timetable_api` and stays low confidence. The public booking HTML is the first-party schedule (`frontier_schedule`).

## Airport press

Comma-separated URLs in `AIRPORT_PRESS_URLS`. The same announcement parser runs, and the observation is retagged as airport press, tier 2. No URLs means a skipped run.

## Programs

Pages:

- `https://www.flyfrontier.com/deals/gowild-pass`
- `https://faq.flyfrontier.com/help/how-do-i-book-a-gowild-flight`
- `https://www.flyfrontier.com/deals/discount-den`

The parser keeps a short window of page text only when it matches:

- domestic booking the day before departure (`leadDays: 1`)
- international booking 10 days before departure (`leadDays: 10`)
- a `$0.01` per-segment base fare
- the word blackout followed within a short span by a calendar day (`Dec. 20`, not `Dec.` and not “as posted”)
- a sentence that mentions Discount Den and GoWild and says they are not combined

A successful fetch replaces previously stored rules for the pages that responded. A failed page leaves its last rules in place. No matching sentence means no rule is inserted.

## BTS popularity

International segments use the public SODA resource `https://data.transportation.gov/resource/xgub-n9bw.json` with `carrier='F9'` and `type='Passengers'`. The adapter asks for the latest year, then the numeric maximum month in that year, then gateway and foreign airport totals. The period label is stored with the metric. Direction is the U.S. gateway toward the foreign airport, which is how T-100 international segments are published.

Domestic T-100 is not queried unless `BTS_DOMESTIC_RESOURCE_URL` is set. The consumer-airfare market table is not used, because it is not Frontier-only. Missing domestic data is reported as unavailable.

Popularity metrics are not route observations and are not drawn as the current network. Replacing metrics deletes only the same source and period, then inserts the new pull.

## Airport reference

`data/airports.json` is generated from OurAirports (public domain) joined to OpenFlights timezones (ODbL). It includes scheduled large and medium airports, plus small airports with scheduled service, when an IANA timezone was available. Seeding updates names and coordinates. It does not create routes. Unknown IATA codes seen in an observation are inserted as stubs (`country` `ZZ`) so the observation can be stored; they are not given invented coordinates.

## HTTP behavior

`src/server/ingestion/http.ts` spaces requests, retries transport errors and HTTP 429/5xx with exponential backoff, and honors `Retry-After` up to 30 seconds. A non-retryable HTTP error is returned to the adapter. The adapter records the failure on `sync_runs` and returns no observations, so reconciliation cannot read silence as “the route disappeared.”

## Personal data

Home airports, interest airports, saved searches, and the LAS → BUR watch live in preference and saved-route tables. The watch note says a possible October 2026 end was something the user heard. Reconciliation does not read that note. The route page shows it beside the data, and it does not set `suspectedEndDate`.
