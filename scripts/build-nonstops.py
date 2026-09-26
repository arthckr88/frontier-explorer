"""Rebuild data/nonstops.json from monthly US DOT T-100 Segment zips.

Download each month from
https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FMG
(table T-100 Segment, All Carriers) with UNIQUE_CARRIER, ORIGIN, DEST,
YEAR, MONTH, DEPARTURES_PERFORMED, PASSENGERS, DATA_SOURCE, and CLASS.
Pass the directory of those zip files as the first argument.
"""

import csv
import io
import json
import sys
import zipfile
from pathlib import Path

MONTHS = [
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
]


def pairs_from(directory: Path):
    kept = set()
    for month in MONTHS:
        with zipfile.ZipFile(directory / f"{month}.zip") as archive:
            with archive.open(archive.namelist()[0]) as raw:
                text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
                for row in csv.DictReader(text):
                    if (row.get("UNIQUE_CARRIER") or "").strip() != "F9":
                        continue
                    if (row.get("CLASS") or "").strip() != "F":
                        continue
                    if float(row["DEPARTURES_PERFORMED"]) <= 0 or float(row["PASSENGERS"]) <= 0:
                        continue
                    kept.add((row["ORIGIN"].strip(), row["DEST"].strip()))
    return kept


def main():
    directory = Path(sys.argv[1])
    kept = pairs_from(directory)
    count = len(kept)
    payload = {
        "carrier": "F9",
        "sourceName": "US DOT T-100 Segment (All Carriers)",
        "sourceUrl": "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FMG",
        "periodStart": "2025-07",
        "periodEnd": "2026-06",
        "rule": "UNIQUE_CARRIER F9, CLASS F, DEPARTURES_PERFORMED > 0, and PASSENGERS > 0",
        "sentence": (
            f"This map shows {count:,} Frontier nonstop city pairs from US DOT T-100 Segment reports "
            "for July 2025 through June 2026, which does not include flights between two foreign airports."
        ),
        "pairs": [{"origin": origin, "destination": destination} for origin, destination in sorted(kept)],
    }
    target = Path(__file__).resolve().parents[1] / "data" / "nonstops.json"
    target.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {count} pairs to {target}")


if __name__ == "__main__":
    main()
