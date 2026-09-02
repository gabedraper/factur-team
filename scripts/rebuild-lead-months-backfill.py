#!/usr/bin/env python3
"""Load monthly lead counts per client, on the every-opportunity definition."""
import json, glob, sys, urllib.request, datetime

TR = ("/Users/gabedraper/.claude/projects/-Users-gabedraper/"
      "3cd72243-f08a-4fa9-bb7a-84816bd37c17/tool-results")
FILES = ["1788385331235", "1788385536131"]

env = dict(l.split("=", 1) for l in open("/Users/gabedraper/factur-team/.env.local")
           if "=" in l and not l.strip().startswith("#"))
URL = env["NEXT_PUBLIC_SUPABASE_URL"].strip()
KEY = env["SUPABASE_SERVICE_ROLE_KEY"].strip()


def rest(path, method="GET", body=None, prefer=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(
        f"{URL}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method, headers=h)
    try:
        raw = urllib.request.urlopen(req).read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: {e.code} {e.read().decode()[:600]}")
    return json.loads(raw) if raw else None


known = set()
off = 0
while True:
    page = rest(f"client_roster?select=salesforce_client_id&limit=1000&offset={off}")
    if not page:
        break
    known |= {r["salesforce_client_id"] for r in page}
    if len(page) < 1000:
        break
    off += 1000

rows, skipped = [], 0
for i in FILES:
    for g in json.load(open(glob.glob(f"{TR}/*soqlQuery-{i}.txt")[0]))["records"]:
        cid = g["Client__c"]
        if cid not in known:
            skipped += 1
            continue
        rows.append({
            "salesforce_client_id": cid,
            "month_start": datetime.date(g["y"], g["m"], 1).isoformat(),
            "leads": g["n"],
        })

print(f"rows {len(rows)}  clients {len({r['salesforce_client_id'] for r in rows})}"
      f"  months {len({r['month_start'] for r in rows})}  skipped {skipped}")
if "--dry" in sys.argv:
    sys.exit(0)

rest("client_lead_months_backfill?leads=gte.0", "DELETE", prefer="return=minimal")
for i in range(0, len(rows), 500):
    rest("client_lead_months_backfill?on_conflict=salesforce_client_id,month_start",
         "POST", rows[i:i + 500], prefer="resolution=merge-duplicates,return=minimal")
print(f"loaded {len(rows)}")
