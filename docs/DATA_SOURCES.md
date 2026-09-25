# Data sources

Every network fact is an observation. An observation records the source id, display name, tier, kind, URL when one exists, retrieval time, external id, and the directional pair. Reconciliation may disagree with an observation. It does not rewrite it.

## Tiers

1. Frontier public pages and feeds: Newsroom, flights-from pages, GoWild, Discount Den.
2. Airport press releases listed in `AIRPORT_PRESS_URLS`. Empty means this tier is skipped.
3. A timetable URL you configure. The process skips it when `TIMETABLE_API_URL` is unset. The optional key is sent as a bearer token and is not stored.
4. U.S. DOT / BTS passenger statistics. Popularity is not frequency.

The adapters do not log into a Frontier account, call an undocumented private booking API, or read Google Flights.

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

`src/server/ingestion/sources/schedule.ts` requests `TIMETABLE_API_URL` and expects a JSON array of `{ origin, destination, date, departureLocal?, arrivalLocal?, flightNumber?, windowStart?, windowEnd? }`. Rows are grouped into one schedule snapshot per direction. The snapshot’s external id includes the retrieval date, so a later payload with different flights is a new observation. An identical hash only bumps `last_retrieved_at`.

There is no built-in Frontier schedule URL. Leaving the variable empty records `skipped` on `/system/data` and leaves existing observations in place.

Confidence treats `sourceKind: "frontier_schedule"` as a first-party schedule and `timetable_api` as a secondary timetable. The configured adapter uses `timetable_api`, so a key-backed feed alone is low confidence until an official announcement agrees. High confidence requires a first-party schedule kind plus an official announcement. This repository does not invent that first-party feed.

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
