import json, subprocess, sys
subprocess.run(["node", "basemap.mjs", "network.json"], check=True)
base = open("basemap.json").read()
data = open("network.json").read()
html = open("template.html").read().replace("__DATA__", data).replace("__BASE__", base)
open(sys.argv[1], "w").write(html)
print("bytes", len(html))
