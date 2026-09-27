"""Build data/operating-days.json from BTS Airline On-Time and T-100 zips.

On-time zips are monthly downloads from
https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ
with FL_DATE, OP_UNIQUE_CARRIER, OP_CARRIER_FL_NUM, ORIGIN, DEST,
CRS_DEP_TIME, CRS_ARR_TIME, and CANCELLED.

T-100 zips are the monthly segment files used for data/nonstops.json.
A pair with no on-time row keeps only the T-100 months. Daily dates are
not invented from a month total.
"""

import csv
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
T100_MONTHS = [
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


def parse_date(value):
    token = value.strip().split()[0]
    month, day, year = token.split("/")
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def parse_clock(value):
    text = (value or "").strip()
    if not text or text.lower() == "null":
        return None
    number = int(float(text))
    if number == 2400:
        return "0000", True
    if number < 0 or number > 2359:
        return None
    hours, minutes = divmod(number, 100)
    if hours > 23 or minutes > 59:
        return None
    return f"{hours:02d}{minutes:02d}", False


def ontime_flights(directory: Path):
    flights = defaultdict(set)
    months = []
    for path in sorted(directory.glob("*.zip")):
        months.append(path.stem)
        with zipfile.ZipFile(path) as archive:
            with archive.open(archive.namelist()[0]) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
                for row in reader:
                    if (row.get("OP_UNIQUE_CARRIER") or "").strip() != "F9":
                        continue
                    if (row.get("CANCELLED") or "").strip() not in {"0", "0.00", "0.0"}:
                        continue
                    origin = (row.get("ORIGIN") or "").strip()
                    destination = (row.get("DEST") or "").strip()
                    if len(origin) != 3 or len(destination) != 3:
                        continue
                    try:
                        date = parse_date(row["FL_DATE"])
                    except (ValueError, KeyError, AttributeError):
                        continue
                    departure = parse_clock(row.get("CRS_DEP_TIME"))
                    arrival = parse_clock(row.get("CRS_ARR_TIME"))
                    if not departure or not arrival:
                        continue
                    number = (row.get("OP_CARRIER_FL_NUM") or "").strip()
                    if number.endswith(".00"):
                        number = number[:-3]
                    if not number:
                        continue
                    rolled = "1" if departure[1] or arrival[1] or arrival[0] <= departure[0] else "0"
                    flights[f"{origin}|{destination}"].add(f"{date}|{number}|{departure[0]}|{arrival[0]}|{rolled}")
    return flights, months


def t100_months(directory: Path):
    months = defaultdict(set)
    for month in T100_MONTHS:
        path = directory / f"{month}.zip"
        with zipfile.ZipFile(path) as archive:
            with archive.open(archive.namelist()[0]) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
                for row in reader:
                    if (row.get("UNIQUE_CARRIER") or "").strip() != "F9":
                        continue
                    if (row.get("CLASS") or "").strip() != "F":
                        continue
                    if float(row["DEPARTURES_PERFORMED"]) <= 0 or float(row["PASSENGERS"]) <= 0:
                        continue
                    origin = row["ORIGIN"].strip()
                    destination = row["DEST"].strip()
                    months[f"{origin}|{destination}"].add(month)
    return months


def main():
    ontime_dir = Path(sys.argv[1])
    t100_dir = Path(sys.argv[2])
    daily, covered = ontime_flights(ontime_dir)
    monthly_all = t100_months(t100_dir)
    # A pair with no daily rows keeps the T-100 months. A pair that has daily
    # rows uses those days, so a month total is not turned into extra dots.
    monthly = {key: sorted(months) for key, months in monthly_all.items() if key not in daily and months}
    period_start = min(covered)
    period_end = max(covered)
    payload = {
        "daily": {
            "carrier": "F9",
            "sourceName": "US DOT BTS Airline On-Time Performance",
            "sourceUrl": "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ",
            "periodStart": f"{period_start}-01",
            "periodEnd": period_end,
            "rule": "OP_UNIQUE_CARRIER F9 and CANCELLED = 0, with a scheduled departure and arrival",
            "sentence": (
                "Operating days are Frontier flights in US DOT BTS Airline On-Time Performance "
                f"from {period_start}-01 through the last day of {period_end}."
            ),
            "flights": {key: sorted(values) for key, values in sorted(daily.items())},
        },
        "monthly": {
            "carrier": "F9",
            "sourceName": "US DOT T-100 Segment (All Carriers)",
            "sourceUrl": "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FMG",
            "periodStart": T100_MONTHS[0],
            "periodEnd": T100_MONTHS[-1],
            "rule": "UNIQUE_CARRIER F9, CLASS F, DEPARTURES_PERFORMED > 0, and PASSENGERS > 0, with no daily on-time row",
            "sentence": (
                "Daily dates are not in US DOT T-100 Segment reports for July 2025 through June 2026."
            ),
            "pairs": dict(sorted(monthly.items())),
        },
    }
    # periodEnd for daily is YYYY-MM. The client sentence uses an explicit last day.
    last_year, last_month = period_end.split("-")
    last_day = {"01": 31, "02": 28, "03": 31, "04": 30, "05": 31, "06": 30, "07": 31, "08": 31, "09": 30, "10": 31, "11": 30, "12": 31}[last_month]
    if last_month == "02" and int(last_year) % 4 == 0:
        last_day = 29
    payload["daily"]["periodEnd"] = f"{period_end}-{last_day:02d}"
    payload["daily"]["sentence"] = (
        "Operating days are Frontier flights in US DOT BTS Airline On-Time Performance "
        f"from {period_start}-01 through {period_end}-{last_day:02d}."
    )
    target = ROOT / "data" / "operating-days.json"
    target.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(
        f"Wrote {target} daily_pairs={len(daily)} monthly_pairs={len(monthly)} "
        f"bytes={target.stat().st_size} bna_lax_months={monthly.get('BNA|LAX')}"
    )


if __name__ == "__main__":
    main()
