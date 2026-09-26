# Itinerary engine

Search is a directed graph walk in `src/lib/graph/search.ts`. Airports are nodes. A scheduled flight with a local departure and arrival is an edge. Announcement-only pairs are not given invented clock times. The planner says so and can still list untimed paths from stored projections via `src/lib/graph/untimed.ts`.

## Inputs

`planItineraries` loads `flight_instances` whose operating date falls in a short horizon from the requested date: one extra day when intentional stopovers are allowed, three when multi-day is allowed. Each instance needs an origin timezone from the airport table. Missing local times never become a flight edge.

The query carries:

- origins and destinations (a metro expands to the physical airports it names)
- date
- max stops (default 1, user range 0–2)
- minimum connection (default 60 minutes, form clamps 45–240)
- long connection (4–8 hours), intentional stopover (8–24 hours), multi-day (off by default, up to 72 hours)
- red-eye exclusion (default on)
- maximum journey (default 36 hours)
- prefer Las Vegas stopover (default on)
- optional “unusual” sort

## Time

Connection and elapsed minutes use Luxon with IANA zones. Local timestamps are not subtracted from each other. A connection that leaves before it arrives, or that is shorter than the minimum, is rejected. The DST test fixes America/New_York on 2026-03-08: 01:30 to 03:30 is 60 minutes, so a 90-minute minimum rejects it. The same clock labels on a non-transition day can be a valid 120-minute connection.

## Red-eyes

A segment is a red-eye when its local departure is from 22:00 inclusive through 05:00 exclusive, or when it is airborne at least 3 hours, departs at or after 17:00, lands on a later local date, and arrives before 08:00 local. Ground time is not a red-eye. An Oakland departure at 19:00, a night in Las Vegas, and a late-morning Las Vegas departure stay in the results when intentional stopovers are on. An overnight airborne segment is removed when the toggle is on.

## Stopovers

Categories:

- normal: 1–4 hours
- long: 4–8 hours
- intentional stopover: 8–24 hours
- multi-day: 24–72 hours, off unless the preference says so

A connection outside the enabled categories is dropped. Overnight ground time at LAS is labeled “Overnight in Las Vegas”. It is a positive ranking factor when “prefer Las Vegas stopover” is on. It is not described as a bad layover.

## Ranking

Factors are listed on the itinerary. The sort is lexicographic, then the numeric score:

1. no red-eye
2. preferred origin (OAK before SFO by default)
3. preferred destination (LAX and BUR before nearby Los Angeles airports)
4. fewer stops
5. score

Score factors include daytime departure, connection length, nonstop, frequency when the edge has one, and the Las Vegas overnight bonus. There is no hidden model score.

“Show me routes I probably haven’t considered” keeps the red-eye and connection rules. It sorts connection airports that are rarer in the loaded flight set ahead of airports that appear more often than the median. The rare set is computed from the flights in the query, not from a hardcoded hub list. Nonstops stay in the middle of that ordering.

## Saved modules

- Bay Area → Los Angeles: origins OAK and SFO, destinations LAX and BUR. Nearby adds SJC, SNA, and ONT and labels them as nearby.
- Bay Area → New York: origins OAK and SFO, destinations LGA and JFK. Nearby can add EWR. Hubs are whatever the graph returns.
- Florida: MCO, FLL, and MIA, with MCO treated as the primary card.

Search understands the same groups: “New York” is JFK and LGA, with EWR nearby; “LA” is LAX and BUR, with SNA and ONT nearby; “Bay Area” is OAK and SFO, with SJC nearby. SJC is not a home airport.

## Booking

Each timed option links to `https://www.flyfrontier.com/travel/book/flight/` with `from`, `to`, and `departureDate`. That is a handoff, not a booking. Fare mode (standard, Discount Den, GoWild) is a preference. The engine does not quote a fare and does not confirm a GoWild seat.
