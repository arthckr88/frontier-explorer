import json, re, time, urllib.request, urllib.parse, sys
UA = {"User-Agent": "FrontierNetworkMap/1.0 (personal route map)"}
API = "https://en.wikipedia.org/w/api.php"
def api(params):
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as e:
            print("retry", i, e, file=sys.stderr, flush=True); time.sleep(2 + i * 3)
    raise RuntimeError("failed " + url)

# 1. list page
lst = api({"action": "parse", "page": "List of Frontier Airlines destinations", "prop": "wikitext", "redirects": 1})["parse"]["wikitext"]
rows = lst.split("\n|-")
airports = []
for row in rows:
    links = re.findall(r"\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]", row)
    ap = [l for l in links if re.search(r"Airport|Airfield|International|Field|Jetport", l)]
    if not ap:
        continue
    term = "{{terminated" in row.lower() or "terminated}}" in row.lower()
    airports.append({"title": ap[0], "terminated": term, "note": re.sub(r"<ref.*?(</ref>|/>)", "", row, flags=re.S)[-300:]})
active = [a for a in airports if not a["terminated"]]
print("list airports", len(airports), "active", len(active), file=sys.stderr)

def get_wikitexts(titles):
    out = {}
    for i in range(0, len(titles), 10):
        chunk = titles[i:i+10]
        d = api({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "titles": "|".join(chunk), "redirects": 1})
        q = d["query"]
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        pages = {p["title"]: p for p in q["pages"]}
        for t in chunk:
            tt = norm.get(t, t); tt = redir.get(tt, tt)
            p = pages.get(tt)
            if p and "revisions" in p:
                out[t] = (tt, p["revisions"][0]["slots"]["main"]["content"])
        print("batch", i, len(out), file=sys.stderr, flush=True)
        time.sleep(1)
    return out

def iata_of(text):
    m = re.search(r"\|\s*IATA\s*=\s*([A-Z0-9]{3})", text)
    return m.group(1) if m else None

def coords(text):
    m = re.search(r"\{\{\s*[Cc]oord\s*\|([^}]*)\}\}", text)
    if not m: return None
    parts = [p.strip() for p in m.group(1).split("|")]
    nums = []; dirs = []
    for p in parts:
        if re.fullmatch(r"-?\d+(\.\d+)?", p): nums.append(float(p))
        elif p in ("N","S","E","W"): dirs.append((len(nums), p))
        elif "=" in p: break
    try:
        if not dirs:
            return [nums[0], nums[1]]
        # dms with N/S then E/W
        ns_i = [i for i,(k,p) in enumerate(dirs) if p in "NS"][0]
        k1, p1 = dirs[ns_i]; k2, p2 = dirs[ns_i+1]
        lat_parts = nums[:k1]; lon_parts = nums[k1:k2]
        f = lambda v: v[0] + (v[1]/60 if len(v)>1 else 0) + (v[2]/3600 if len(v)>2 else 0)
        lat = f(lat_parts) * (-1 if p1=="S" else 1); lon = f(lon_parts) * (-1 if p2=="W" else 1)
        return [round(lat,4), round(lon,4)]
    except Exception:
        return None

def split_top(t):
    out, depth_l, depth_t, cur, i = [], 0, 0, "", 0
    while i < len(t):
        two = t[i:i+2]
        if two == "[[": depth_l += 1; cur += two; i += 2; continue
        if two == "]]": depth_l = max(0, depth_l-1); cur += two; i += 2; continue
        if two == "{{": depth_t += 1; cur += two; i += 2; continue
        if two == "}}": depth_t = max(0, depth_t-1); cur += two; i += 2; continue
        if t[i] == "|" and depth_l == 0 and depth_t == 0:
            out.append(cur); cur = ""; i += 1; continue
        cur += t[i]; i += 1
    out.append(cur)
    return out

def frontier_block(text):
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "\n<!---->\n", text, flags=re.S)
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        m = re.search(r"\[\[Frontier Airlines(\|[^\]]*)?\]\]", ln)
        if not m: continue
        st = ln.strip()
        if not (st.startswith("|") or st.startswith("!")): continue
        if "Cargo" in st[:m.end()+10]: continue
        chunk = [st]
        for nxt in lines[i+1:i+12]:
            t = nxt.strip()
            if t.startswith("<!--") or t.startswith("|-") or t.startswith("}}") or t.startswith("|}") or re.match(r"\|\s*(\{\{nowrap\|)?\[\[", t) or (t.startswith("|") and len(chunk) > 1 and "[[" not in t and "Seasonal" not in t):
                break
            chunk.append(t)
        joined = " ".join(chunk)
        joined = joined.replace("||", "|")
        cells = [c.strip() for c in split_top(joined)]
        idx = next((k for k, c in enumerate(cells) if "Frontier Airlines" in c and c.count("[[") == 1), None)
        if idx is None: continue
        rest = [c for c in cells[idx+1:] if c]
        if not rest: continue
        dest = rest[0]
        if dest.count("[[") == 0 and len(rest) > 1: dest = rest[1]
        if dest.count("[[") < 1 or "=" in dest.split("[[")[0]: continue
        return dest
    return None

def parse_dests(block):
    block = re.sub(r"<ref[^>]*/>", "", block)
    block = re.sub(r"<ref[^>]*>.*?</ref>", "", block, flags=re.S)
    res = []
    seasonal = False
    # tokenize by links and seasonal markers
    for m in re.finditer(r"'''\s*Seasonal(?: charter)?\s*:?\s*'''|Seasonal\s*:|\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]\s*(\{\{\s*(?:small|nowrap)\s*\|\s*\(?([^}]*)\)?\s*\}\}|\(([^)]*)\))?", block):
        if m.group(1) is None:
            seasonal = True; continue
        target, note = m.group(1), (m.group(4) or m.group(5) or "")
        res.append({"target": target.strip(), "label": (m.group(2) or target).strip(), "seasonal": seasonal, "note": note.strip()})
    return res

titles = [a["title"] for a in active]
import os
if os.path.exists("cache_texts.json"):
    texts = {k: tuple(v) for k, v in json.load(open("cache_texts.json")).items()}
else:
    texts = get_wikitexts(titles); json.dump(texts, open("cache_texts.json","w"))
print("fetched", len(texts), file=sys.stderr)
nodes = {}; raw = {}
for t,(tt,txt) in texts.items():
    code = iata_of(txt)
    if not code: continue
    nodes[code] = {"title": tt, "coord": coords(txt), "listNote": next(a["note"] for a in active if a["title"]==t)}
    blk = frontier_block(txt)
    raw[code] = parse_dests(blk) if blk else None

# resolve link targets to IATA
title2code = {}
for code,n in nodes.items(): title2code[n["title"]] = code
for t,(tt,txt) in texts.items():
    c = iata_of(txt)
    if c: title2code[t] = c
unknown = sorted({d["target"] for v in raw.values() if v for d in v if d["target"] not in title2code})
print("unknown targets", len(unknown), file=sys.stderr)
extra = get_wikitexts(unknown)
for t,(tt,txt) in extra.items():
    c = iata_of(txt)
    if c:
        title2code[t] = c; title2code[tt] = c
        if c not in nodes:
            nodes[c] = {"title": tt, "coord": coords(txt), "listNote": "not in Frontier list page"}
routes = []
unres = []
for o,v in raw.items():
    if not v: continue
    for d in v:
        c = title2code.get(d["target"])
        if not c:
            unres.append((o, d["target"])); continue
        routes.append({"o": o, "d": c, "seasonal": d["seasonal"], "note": d["note"]})
json.dump({"retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "English Wikipedia airport articles, Airlines and destinations tables", "nodes": nodes, "routes": routes, "noFrontierRow": [c for c,v in raw.items() if not v], "unresolved": unres}, open("wiki_network.json","w"), indent=1)
print("nodes", len(nodes), "routes", len(routes), "no row", len([c for c,v in raw.items() if not v]), "unresolved", len(unres), file=sys.stderr)
