import zipfile, csv, io, json, sys, collections
out = collections.defaultdict(lambda: {"days": set(), "dows": collections.Counter()})
months = []
for fn in sys.argv[1:]:
    z = zipfile.ZipFile(fn)
    name = [n for n in z.namelist() if n.endswith(".csv")][0]
    with z.open(name) as f:
        r = csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"))
        mset = set()
        for row in r:
            if row["Reporting_Airline"] != "F9": continue
            mset.add(row["FlightDate"][:7])
            key = (row["Flight_Number_Reporting_Airline"], row["Origin"], row["Dest"], row["CRSDepTime"], row["CRSArrTime"], row["CRSElapsedTime"])
            out[key]["days"].add(row["FlightDate"]); out[key]["dows"][row["DayOfWeek"]] += 1
        months += sorted(mset)
recs = []
for (fl, o, d, dep, arr, el), v in out.items():
    if len(v["days"]) < 4: continue
    recs.append([o, d, "F9 " + fl, dep.zfill(4), arr.zfill(4), int(float(el or 0)), len(v["days"]), "".join(sorted(v["dows"]))])
recs.sort()
json.dump({"months": sorted(set(months)), "source": "BTS Reporting Carrier On-Time Performance (scheduled times, local)", "flights": recs}, open("bts_schedule.json", "w"), separators=(",", ":"))
print("months", sorted(set(months)), "patterns", len(recs), "pairs", len({(r[0], r[1]) for r in recs}))
