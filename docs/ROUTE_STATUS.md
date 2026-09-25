# Route status

Routes are directional. `OAK → LAS` and `LAS → OAK` are different rows. The map may draw both. Frequency, days, and dates are not copied from one direction to the other.

The current projection is derived from the latest observation of each kind, source, external id, and direction. Older observations remain in `route_observations`. A snapshot is appended to `route_snapshots` when reconciliation emits a change. `flight_instances` is a replaceable search index of flights that have both a local departure and a local arrival. History lives in observations, snapshots, and `route_changes`.

## Status

| Status | Meaning |
| --- | --- |
| `ANNOUNCED` | An announcement has a start date after today, and no schedule snapshot has validated it |
| `UPCOMING` | Schedule flights exist, and they are all on or after an announced start that is still in the future |
| `ACTIVE` | A fresh schedule snapshot includes a future flight |
| `SEASONAL` | The announcement is seasonal, no future flight is in the current snapshot, and no confirmed end agrees |
| `ENDING_SOON` | A confirmed end is within the ending-soon window, or a later flight disappeared while the check looked past the new last date. The second case is not a confirmed end |
| `POSSIBLY_ENDING` | A fresh check whose window covers the lookahead found no future flight, or sources disagree and the fresh check is empty. Not ended |
| `PAUSED` | Reserved for an explicit pause. The current derivation uses `SEASONAL` for a seasonal gap |
| `ENDED` | An official end and the last scheduled flight agree, the check is fresh, and that date is before today |
| `STALE` | A schedule snapshot exists, but it is older than the stale threshold, so it was not rechecked |
| `UNKNOWN` | Evidence is missing, only a marketed sample exists, or an announced launch date passed with no schedule |

A route does not jump to `ENDED` because tomorrow is empty. Future flights inside the snapshot keep it `ACTIVE`, including a twice-weekly pattern whose next flight is not tomorrow. A sparse published frequency (at most 3 flights per week) must be checked across the longer of the possibly-ending gap and the sparse lookahead before an empty snapshot can become `POSSIBLY_ENDING`. A seasonal route that vanishes for months stays `SEASONAL` unless an official end and the schedule agree.

If today is past an announced start and no schedule observation exists, `launchUnverified` is set. The UI says the launch was not confirmed. It does not count the route as operating.

## Confidence

Confidence is a rule, not a score.

| Value | Rule |
| --- | --- |
| `HIGH` | A first-party Frontier schedule snapshot and an official announcement agree |
| `MEDIUM` | A first-party schedule snapshot exists and no announcement conflicts with it |
| `LOW` | The only schedule evidence is the secondary timetable (`timetable_api`) |
| `CONFLICTING` | Sources disagree by more than the disagreement threshold (default 1 day) on the last flight or the announced end |
| `UNKNOWN` | There is no schedule evidence strong enough to confirm current service |

The configured timetable adapter is secondary. Newsroom rows alone stay `UNKNOWN` confidence even when the status is `ANNOUNCED`.

When sources disagree, `suspectedEndDate` is null. Both dates are listed. The UI must not collapse them into one confirmed end. A watched route such as LAS → BUR can show a personal note and, separately, whatever the observations say. The note is not a source.

## Copy

Countdowns use `src/lib/time/copy.ts`.

- Future announced start: “Starts in N days”.
- Confirmed end: “Route ends in N days” or “Confirmed discontinuation”.
- Unconfirmed last flight: “Last currently observed scheduled service in N days”.
- Possible end or stale: “No upcoming service in the latest check. This is not a confirmed end.”
- The phrase “Route ends in N days” is used only when `endConfirmed` is true.

## Change events

Reconciliation emits `route_changes` rows. The first observation of a pair emits `NEW_ROUTE`. A first observation that is already conflicting also emits `SOURCE_DISAGREEMENT`. Later comparisons can emit `ROUTE_RETURNING`, `ROUTE_STARTED`, `FREQUENCY_INCREASED`, `FREQUENCY_DECREASED`, `SCHEDULE_SHIFTED`, `POSSIBLE_ROUTE_END`, `ROUTE_END_CONFIRMED`, `SEASONAL_PAUSE`, and `ROUTE_RETURNED`.

Identical observation content does not create a new observation row. `last_retrieved_at` moves forward. A failed fetch adds a `sync_runs` error and no observation, so the previous projection remains.

## Thresholds

Defaults live in `src/server/reconciliation/thresholds.ts` and can be overridden with the variables in `.env.example`.

- `ENDING_SOON_DAYS` (21) — confirmed final flight is soon
- `POSSIBLY_ENDING_GAP_DAYS` (21) — empty fresh window required before a possible end
- `SPARSE_LOOKAHEAD_DAYS` (21) — extra lookahead for a published frequency of 3 or fewer flights per week
- `STALE_VERIFICATION_HOURS` (48) — schedule snapshots older than this are stale, not ended
- `SEASONAL_GAP_DAYS` (60) — documented seasonal gap; seasonal status itself comes from the announcement flag
- Disagreement of more than 1 day, and a 7-day horizon slack so a schedule that simply stops at the edge of the loaded window is not treated as an end

## What the screens show

`/changes` reads `route_changes`. `/rankings/frequency` uses `currentFrequencyPerWeek` from schedule snapshots only. Announced frequency is labeled separately and is not the most-frequent ranking. `/rankings/popularity` reads BTS metrics and shows the period. `/system/data` shows the latest sync run per job, including skipped and failed sources.
