# GitHub source integration

Neither repository is a runtime. Nothing in GitHub Actions calls them. No token, device id, or signing key from either project is stored here.

## GWsearch

License: CC BY-NC-ND. Its code is not copied into this repository.

The historical schema describes a GoWild flag, a price, seats, stops, duration, departure, a round-trip flag, date checks, and a rate-limit caution. Old RetrieveSchedule / InternalSelect calls are not assumed to work.

What this product implements instead: GoWild, Standard, and Discount Den prices come only from FlightData captured by the local headed browser. Seats stay empty because FlightData in the stored fares has no seat count. Stops and overall times are kept on the fare row. A connection is not drawn as the first flight to the final city. There is no round-trip search and no copied rate-limit client.

## FrontierWildWatch

License: MIT. A live nonce probe returned HTTP 406 with an empty body. That client is not a runtime here.

The schema describes fare bundles, availability keys, `includeAllotments`, a blocked state, token signing, and a cooldown. Allotments are documented as a field the other project requests. This product does not claim seat inventory from that field.

What is not implemented, and why: the mobile signing handshake, anonymous token, device id, and subscription key are not copied. The GoWild-then-Standard price fallback is not used. A blocked browser check stays blocked. It is not rewritten as an empty schedule or as a zero fare.

Standard, Discount Den, and GoWild remain three separate fare fields on each stored itinerary.
