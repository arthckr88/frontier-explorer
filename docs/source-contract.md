# Source contract

Frontier Route Explorer keeps these sources separate. A later source does not rewrite an earlier one into a different kind of fact.

## A. Current direct network

Frontier-owned explicit nonstop evidence or an official airport’s airline-specific nonstop listing, with a source URL and retrieval date, or a dated nonstop schedule observation. A fare-market card with two airport codes does not prove a nonstop: missing, null, or empty layover metadata is unknown. Reading additional fare-module pages does not change that. Legacy fare-market pairs are retained as raw research in `data/frontier-direct-routes.json` but excluded from the published direct graph. Reviewed explicit evidence lives in `data/verified-direct-routes.json`. The integrity check rejects direct routes without that evidence. Generic bookable markets, city-to-city sitemap URLs, and popularity links are not nonstops. A challenge stops collection; no private keys or copied authorization headers are used.

## B. Dated schedule and fares

Local headed browser only. The path is the flyfrontier.com form, then booking.flyfrontier.com, then FlightData. This is not a cloud cron. Standard, Discount Den, and GoWild stay separate fields. A connection fare is an itinerary, not a nonstop arc.

## C. GWsearch

Historical schema research only. The license is CC BY-NC-ND. Its code is not copied. Old RetrieveSchedule / InternalSelect is not assumed to work.

## D. FrontierWildWatch

Schema research only. The license is MIT, and the live nonce test returned HTTP 406. It is not a runtime. Tokens and device ids are not copied. Its GoWild-then-Standard fallback is not used.

## E. DOT/BTS

Historical popularity and frequency only. The period is labeled. This is not current service and does not create a current edge.

## F. FlyGoWild and SearchGWP

Behavioral reference only. They are not scraped.

## G. Frontier NDC

No credentials. Not a runtime.

## Precedence

Official explicit direct evidence, plus a dated browser nonstop, decides route existence. A dated browser observation decides a flight. FlightData decides a fare. DOT/BTS is history. GitHub repositories are schema only. Generic markets are candidates only.


## H. Official airport route lists and departure boards

Portland airport's `https://www.flypdx.com/NonstopDestinations` publicly embeds airline-specific active nonstop records. Only active F9 records are imported; seasonal flags are preserved. `https://www.flypdx.com/Flights` publicly embeds dated departures. A departure must have carrier F9, departure direction D, one named destination, and a matching official nonstop listing. Cancelled records are excluded. The airport supplies no destination arrival time, fare, or seat inventory. Departure-only records stay in `data/airport-departures.json`, never become complete flight observations, and never create timed connections. `npm run refresh:airports` refreshes the stored snapshot manually; no background crawl is added.
