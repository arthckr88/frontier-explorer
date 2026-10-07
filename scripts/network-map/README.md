# Frontier network map

Rebuilds the single-page network map (published as a claude.ai artifact).

1. `python3 wiki_routes.py` — reads each Frontier airport's Wikipedia "Airlines and destinations" row → `wiki_network.json` (nonstops, seasonal flags, begins/resumes/ends dates).
2. Download the latest BTS on-time zip (`https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_YYYY_M.zip`) and run `python3 bts_sched.py <zip>` → `bts_schedule.json` (every F9 flight operated, scheduled local times).
3. Copy both plus `tz.json` (IATA → [timezone, lat, lon, city, country] from `data/airports.json`) next to these scripts and run `python3 build_data.py YYYY-MM-DD` → `network.json`.
4. `npm i us-atlas world-atlas topojson-client d3-geo` then `python3 assemble.py frontier-network-map.html`.

Status rules: "soon" = begins/resumes date after build date; routes with a past end date are dropped; "july_only" = flew in the BTS month but no longer listed. Connections: ≥50 min ground; "same" ≤6 h; "long" >6 h same day; "over" = next calendar day and >4 h.
