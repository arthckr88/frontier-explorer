"""Merge Wikipedia route listings + BTS July schedules into the map's data file.

Inputs (same dir): wiki_network.json, bts_schedule.json, tz.json
Output: network.json
"""
import json, re, sys
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

TODAY = date.fromisoformat(sys.argv[1] if len(sys.argv) > 1 else "2026-10-07")
wiki = json.load(open("wiki_network.json"))
bts = json.load(open("bts_schedule.json"))
tz = json.load(open("tz.json"))

MONTHS = {m: i for i, m in enumerate(["january","february","march","april","may","june","july","august","september","october","november","december"], 1)}
def parse_date(s):
    s = s.replace(",", " ").lower()
    m = re.search(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", s) or None
    if m and m.group(2) in MONTHS:
        return date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1)))
    m = re.search(r"([a-z]+)\s+(\d{1,2})\s+(\d{4})", s)
    if m and m.group(1) in MONTHS:
        return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    m = re.search(r"([a-z]+)\s+(\d{4})", s)
    if m and m.group(1) in MONTHS:
        return date(int(m.group(2)), MONTHS[m.group(1)], 1)
    return None

# ---------- edges from Wikipedia ----------
edges = {}  # (o,d) -> dict
def edge(o, d):
    return edges.setdefault((o, d), {"listed": False, "listedBy": set(), "seasonal": False, "begins": None, "ends": None, "resumes": None, "flewJuly": 0})

for r in wiki["routes"]:
    o, d = r["o"], r["d"]
    if o == d:
        continue
    note = (r.get("note") or "").lower()
    dt = parse_date(note)
    for a, b in ((o, d), (d, o)):
        e = edge(a, b)
        e["listed"] = True
        e["listedBy"].add(o)
        if r["seasonal"]:
            e["seasonal"] = True
        if dt:
            if "begin" in note or "start" in note:
                e["begins"] = max(e["begins"] or dt, dt) if e["begins"] else dt
            elif "resume" in note:
                e["resumes"] = dt
            elif "end" in note:
                e["ends"] = dt

# ---------- BTS July schedules ----------
flights = bts["flights"]  # [o,d,flt,dep,arr,elapsed,days,dows]
for f in flights:
    edge(f[0], f[1])["flewJuly"] += f[6]

# ---------- airports ----------
codes = sorted({c for k in edges for c in k})
airports = {}
for c in codes:
    n = wiki["nodes"].get(c)
    t = tz.get(c)
    coord = (n or {}).get("coord") or (t and [t[1], t[2]])
    if not coord or not t:
        continue
    airports[c] = {"lat": coord[0], "lon": coord[1], "city": t[3], "country": t[4], "tz": t[0]}

# ---------- route status ----------
routes = []
for (o, d), e in edges.items():
    if o not in airports or d not in airports:
        continue
    status = None
    start = e["begins"] or e["resumes"]
    if start and start > TODAY:
        status = "soon"
    elif e["ends"] and e["ends"] < TODAY:
        continue  # ended
    elif e["listed"]:
        status = "seasonal" if e["seasonal"] and not e["flewJuly"] else "now"
    elif e["flewJuly"]:
        status = "july_only"
    else:
        continue
    routes.append({
        "o": o, "d": d, "s": status,
        "start": start.isoformat() if start and start > TODAY else None,
        "resume": bool(e["resumes"] and not e["begins"] and start and start > TODAY),
        "ends": e["ends"].isoformat() if e["ends"] and e["ends"] >= TODAY else None,
        "seasonal": e["seasonal"],
        "july": e["flewJuly"],
    })

# ---------- connections (July schedules) ----------
JULY_MON = date(2026, 7, 6)  # Monday; BTS DayOfWeek 1=Mon..7=Sun
def utc_minutes(code, d, hhmm):
    zi = ZoneInfo(airports[code]["tz"])
    h, m = int(hhmm[:2]) % 24, int(hhmm[2:])
    dt = datetime(d.year, d.month, d.day, h, m, tzinfo=zi)
    return int(dt.timestamp() // 60)

legs = {}  # origin -> list of leg instances
for f in flights:
    o, d, flt, dep, arr, el, days, dows = f
    if o not in airports or d not in airports or not el:
        continue
    for ch in dows:
        dow = int(ch)
        day = JULY_MON + timedelta(days=dow - 1)
        du = utc_minutes(o, day, dep)
        legs.setdefault(o, []).append({"d": d, "flt": flt, "dep": dep, "arr": arr, "dow": dow, "du": du, "au": du + el})

def local_date(code, utcmin):
    return datetime.fromtimestamp(utcmin * 60, ZoneInfo(airports[code]["tz"])).date()

MIN_CONN = 50
SAME_DAY_MAX = 6 * 60
MAX_WAIT = 30 * 60
nonstop = {(r["o"], r["d"]) for r in routes if r["s"] in ("now", "seasonal", "july_only")}
conn = {}
for a in airports:
    if a not in legs:
        continue
    best = {}  # b -> {"same": opt, "over": opt, "sameDows": set, "overDows": set}
    for l1 in legs[a]:
        h = l1["d"]
        if h not in legs:
            continue
        arr_date = local_date(h, l1["au"])
        for l2 in legs[h]:
            b = l2["d"]
            if b == a or b == h:
                continue
            for wk in (0, 7 * 24 * 60):
                ground = l2["du"] + wk - l1["au"]
                if ground < MIN_CONN or ground > MAX_WAIT:
                    continue
                dep2_date = local_date(h, l2["du"] + wk)
                overnight = dep2_date > arr_date and ground > 4 * 60
                kind = "over" if overnight else ("same" if ground <= SAME_DAY_MAX else "long")
                total = l2["au"] + wk - l1["du"]
                rec = best.setdefault(b, {"same": None, "long": None, "over": None, "dows": {"same": set(), "long": set(), "over": set()}})
                rec["dows"][kind].add(l1["dow"])
                cur = rec[kind]
                if cur is None or total < cur[0]:
                    d0 = local_date(a, l1["du"])
                    off1 = (arr_date - d0).days
                    off2 = (dep2_date - d0).days
                    off3 = (local_date(b, l2["au"] + wk) - d0).days
                    rec[kind] = (total, h, l1["flt"], l1["dep"], l1["arr"], l2["flt"], l2["dep"], l2["arr"], ground, off1, off2, off3)
    out = {}
    for b, rec in best.items():
        if (a, b) in nonstop:
            continue
        row = {}
        for kind in ("same", "long", "over"):
            if rec[kind]:
                t = rec[kind]
                row[kind] = [t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[0], len(rec["dows"][kind]), t[9], t[10], t[11]]
        out[b] = row
    conn[a] = out

data = {
    "builtFor": TODAY.isoformat(),
    "sources": {
        "wikipedia": {"retrievedAt": wiki["retrievedAt"], "what": "Frontier rows in each airport's Airlines and destinations table"},
        "bts": {"months": bts["months"], "what": "Every Frontier flight operated, from BTS on-time data (scheduled local times)"},
    },
    "airports": {c: [round(v["lat"], 3), round(v["lon"], 3), v["city"], v["country"]] for c, v in airports.items()},
    "routes": [[r["o"], r["d"], r["s"], r["start"], r["ends"], 1 if r["seasonal"] else 0, r["july"], 1 if r["resume"] else 0] for r in routes],
    "conn": conn,
}
json.dump(data, open("network.json", "w"), separators=(",", ":"))
from collections import Counter
print("airports", len(airports), "routes", len(routes), Counter(r["s"] for r in routes))
print("soon", sorted((r["start"], r["o"], r["d"]) for r in routes if r["s"] == "soon")[:60])
print("conn origins", len(conn), "pairs", sum(len(v) for v in conn.values()))
