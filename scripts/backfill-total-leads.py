#!/usr/bin/env python3
"""
Bring client_monthly_results.leads onto the every-opportunity definition.

Gabe on 2026-09-03: "a lead is any sales lead that is generated for the client".
The table counted only opportunities delivered to the client, so it read about
one sixth of the truth.

Rather than rebuild the whole table -- which would also recompute appointments,
quotes and POs and risk moving numbers nobody asked to move -- this adds the
difference. The stages below were previously excluded from leads and are now
counted; nothing else about the row changes.

  Prospecting: Cold Referral / Referred / Warm Referral
  Pipeline: LT Follow Up / Warm / Hot / Cold
  Not the DM

DELIBERATELY STILL EXCLUDED, and worth revisiting:

  Prospecting: Cold Call List, Prospecting: Pipeline Cold, Closed: DQ Company,
  Closed: DQ Contact -- list entries and disqualifications, never leads. This
  matches what sf_opp_leads_raw itself contains.

  Cold Outreach (4,741) -- arrives in round bulk chunks, including two clients
  with exactly 1,000 in a single month, which is a list being loaded rather
  than leads being generated. Including it would put false spikes on a handful
  of clients. One line to add if that reading is wrong.

  Eight rare stages totalling 271 rows across eight years -- Linkedin Response,
  No Fit Ever, Qualification Call Complete and the like. 0.06%, left out for
  simplicity rather than principle.
"""
import json, glob, sys, urllib.request, collections

TR = ("/Users/gabedraper/.claude/projects/-Users-gabedraper/"
      "3cd72243-f08a-4fa9-bb7a-84816bd37c17/tool-results")
# Stages previously excluded from leads that Gabe wants counted.
CHUNKS = ["1788386598765", "1788386609927", "1788386618893", "1788386621710",
          "1788386623568", "1788386625752", "1788386656072", "1788386659255",
          "1788386662552", "1788386674730", "1788386642254"]
# Of those, the Prospecting: family, which he does not. Subtracted from the
# same client-months so the net is what gets added.
PROSPECTING = ["1788387512948", "1788387514708", "1788387522721",
               "1788387525998", "1788387528136"]

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


def page(path):
    out, off = [], 0
    while True:
        rows = rest(f"{path}{'&' if '?' in path else '?'}limit=1000&offset={off}")
        if not rows:
            break
        out += rows
        if len(rows) < 1000:
            break
        off += 1000
    return out


# Existing rows, so the extra leads can be attributed to a service the client
# actually ran that month.
existing = page("client_monthly_results?select=salesforce_client_id,service,month_index,"
                "month_start,leads")
by_month = collections.defaultdict(list)
busiest = collections.defaultdict(collections.Counter)
start_of = {}
for r in existing:
    key = (r["salesforce_client_id"], r["month_start"])
    by_month[key].append(r)
    busiest[r["salesforce_client_id"]][r["service"]] += r["leads"]
    start_of[(r["salesforce_client_id"], r["month_index"])] = r["month_start"]

# Month one per client, to place a month that has no row yet.
first_month = {}
for r in existing:
    cid = r["salesforce_client_id"]
    y, m = int(r["month_start"][:4]), int(r["month_start"][5:7])
    idx = r["month_index"]
    anchor = (y * 12 + m) - (idx - 1)
    first_month.setdefault(cid, anchor)

# Net extra leads per client-month: the added stages less the Prospecting ones.
net = collections.Counter()
for c in CHUNKS:
    for g in json.load(open(glob.glob(f"{TR}/*soqlQuery-{c}.txt")[0]))["records"]:
        net[(g["Client__c"], g["y"], g["m"])] += g["n"]
for c in PROSPECTING:
    for g in json.load(open(glob.glob(f"{TR}/*soqlQuery-{c}.txt")[0]))["records"]:
        net[(g["Client__c"], g["y"], g["m"])] -= g["n"]

updates, added, skipped = {}, 0, collections.Counter()
if True:
    for (cid, gy, gm), n in net.items():
        if n <= 0:
            continue
        g = {"Client__c": cid, "y": gy, "m": gm, "n": n}
        month_start = f"{g['y']:04d}-{g['m']:02d}-01"
        rows = by_month.get((cid, month_start))
        if not rows:
            # No existing row for that client-month: the delivered definition
            # saw nothing there. Needs a new row, keyed by month_index.
            if cid not in first_month:
                skipped["client has no results at all"] += n
                continue
            idx = (g["y"] * 12 + g["m"]) - first_month[cid] + 1
            if idx < 1:
                skipped["before month one"] += n
                continue
            svc = busiest[cid].most_common(1)[0][0] if busiest[cid] else "Other"
            key = (cid, svc, idx)
            updates[key] = updates.get(key, {
                "salesforce_client_id": cid, "service": svc, "month_index": idx,
                "month_start": month_start, "leads": 0,
            })
            updates[key]["leads"] += n
            added += n
            continue

        # Add to whichever service did most for them that month.
        target = max(rows, key=lambda r: r["leads"])
        key = (cid, target["service"], target["month_index"])
        updates[key] = updates.get(key, {
            "salesforce_client_id": cid, "service": target["service"],
            "month_index": target["month_index"], "month_start": target["month_start"],
            "leads": target["leads"],
        })
        updates[key]["leads"] += n
        added += n

print(f"extra leads added   {added}")
print(f"rows touched        {len(updates)}")
for k, v in skipped.most_common():
    print(f"  skipped {v}: {k}")

if "--dry" in sys.argv:
    sys.exit(0)

rows = list(updates.values())
for i in range(0, len(rows), 500):
    rest("client_monthly_results?on_conflict=salesforce_client_id,service,month_index",
         "POST", rows[i:i + 500], prefer="resolution=merge-duplicates,return=minimal")
print(f"updated {len(rows)} rows")
