# Retention

`data/flights.json` is the raw Frontier public booking store. It keeps timed nonstops, the dates that were actually checked, blocked dates, and listed market candidates. Listed markets are not confirmed nonstops.

Rows are not deleted on a schedule. A later empty check does not remove an earlier observation. Git history keeps prior copies of the file when the sync workflow commits an update.

`data/network.json` is derived from `data/flights.json` and can be rebuilt with `npm run normalize:network`. It is the file GitHub Pages reads. Rebuilding it does not delete `flights.json`.

`data/route-summaries.json` is the semantic snapshot used to diff route changes. `data/route-changes.json` keeps at most 80 events, and drops events older than 90 days. `data/diagnostics.json` is a build count, not a user-facing schedule.

`data/upcoming.json`, `data/nonstops.json`, and `data/operating-days.json` are historical inputs. Pages does not fetch them. Do not delete them just because the live map stopped using them.
