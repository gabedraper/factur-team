#!/usr/bin/env python3
"""
Rebuild results with two corrections Gabe made on 2026-09-02.

1. A quote counts as a quote whether or not an appointment preceded it, and
   whether or not the opportunity later died. Stage alone missed 3,904 of them
   -- 1,839 sitting at Closed Lost and 1,417 at LT Follow Up, all carrying a
   real quote amount. Quote and PO amounts are now evidence in their own right,
   independent of the stage the record happens to rest at.

2. Client_Since__c is not reliable, so nothing is dropped for falling outside
   it. Month 1 is now the earlier of the recorded start and the client's first
   actual result, and clients with no start date at all are included on the
   strength of their results.
"""
import json, glob, sys, urllib.request, datetime, collections

TR = ("/Users/gabedraper/.claude/projects/-Users-gabedraper/"
      "3cd72243-f08a-4fa9-bb7a-84816bd37c17/tool-results")

# Delivered stages, per service bucket. Unchanged from the last load.
MAIN = {
    "OP":    ["1788206462553", "1788206580551", "1788206620493", "1788206624487"],
    "OSDR":  ["1788206474322"],
    "LG":    ["1788206594182", "1788206596727", "1788206626385", "1788206628110",
              "1788206631776", "1788206666225", "1788206671067", "1788206674721",
              "1788206682674", "1788206686616"],
    "Other": ["1788206591238"],
}
# Every opportunity carrying a quote amount above zero, any stage, any service.
QUOTE_EV = ["1788308942797", "1788308945597", "1788308948362", "1788308951556"]
# Every opportunity carrying a PO amount or a PO date, any stage, any service.
PO_EV = ["1788308959205"]

DELIVERED = {
    "Lead Generated", "Lead Generated: Scheduled", "Pipeline Hot: Appointment set",
    "Pipeline Hot: Quoting", "Pipeline Hot: Quote Follow up",
    "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Supplier forms / NDA",
    "Pipeline - Selling", "Closed: Closed Won", "Closed: Closed Lost",
    "Closed: No Quote", "Sales Support", "Appointment Set", "Proposal",
    "Needs Analysis",
}
APPOINTMENT = {"Pipeline Hot: Appointment set", "Appointment Set", "Lead Generated: Scheduled"}
QUOTE_STAGES = {"Pipeline Hot: Quoting", "Pipeline Hot: Quote Follow up",
                "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Supplier forms / NDA",
                "Pipeline - Selling", "Proposal", "Closed: Closed Won"}
WON = "Closed: Closed Won"

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


def rows(ids):
    for i in ids:
        for g in json.load(open(glob.glob(f"{TR}/*soqlQuery-{i}.txt")[0]))["records"]:
            yield g


# --- recorded start dates ----------------------------------------------------
recorded = {}
off = 0
while True:
    pg = rest(f"client_roster?select=salesforce_client_id,client_since&limit=1000&offset={off}")
    if not pg:
        break
    for r in pg:
        if r["client_since"]:
            recorded[r["salesforce_client_id"]] = datetime.date.fromisoformat(r["client_since"])
    if len(pg) < 1000:
        break
    off += 1000
known = set(rest("client_roster?select=salesforce_client_id&limit=2000")
            and [r["salesforce_client_id"] for r in
                 rest("client_roster?select=salesforce_client_id&limit=2000")])

# --- pass 1: gather every (client, month) that produced anything -------------
# Needed before any month index can be worked out, because month 1 now depends
# on the earliest result as well as the recorded start.
main_rows = list((svc, g) for svc, ids in MAIN.items() for g in rows(ids))
quote_rows = list(rows(QUOTE_EV))
po_rows = list(rows(PO_EV))

earliest = {}
for cid, y, m in ([(g["Client__c"], g["y"], g["m"]) for _, g in main_rows]
                  + [(g["Client__c"], g["y"], g["m"]) for g in quote_rows]
                  + [(g["Client__c"], g["y"], g["m"]) for g in po_rows]):
    d = datetime.date(y, m, 1)
    if cid not in earliest or d < earliest[cid]:
        earliest[cid] = d

start = {}
for cid in set(list(earliest) + list(recorded)):
    if cid not in known:
        continue
    cands = [d for d in (recorded.get(cid), earliest.get(cid)) if d]
    if cands:
        # The earlier of the two. A start date that postdates real work is
        # wrong, and the work is the harder evidence.
        start[cid] = min(cands).replace(day=1)

moved = sum(1 for c in start
            if recorded.get(c) and earliest.get(c) and earliest[c] < recorded[c].replace(day=1))
no_date = sum(1 for c in start if c not in recorded)

# --- service bucket per client-month, for attributing evidence rows ----------
month_service, client_totals = {}, collections.defaultdict(collections.Counter)
for svc, g in main_rows:
    key = (g["Client__c"], g["y"], g["m"])
    month_service.setdefault(key, collections.Counter())[svc] += g["n"]
    client_totals[g["Client__c"]][svc] += g["n"]


def bucket(cid, y, m):
    """Evidence rows carry no service, so they inherit the client's for that
    month, falling back to whichever service did most for them overall."""
    c = month_service.get((cid, y, m))
    if c:
        return c.most_common(1)[0][0]
    if client_totals[cid]:
        return client_totals[cid].most_common(1)[0][0]
    return "Other"


def idx(cid, y, m):
    s = start[cid]
    return (y - s.year) * 12 + (m - s.month) + 1


cells = collections.defaultdict(lambda: dict(leads=0, appointments=0, quotes=0,
                                             pos=0, quote_amount=0.0, po_amount=0.0))
skipped = collections.Counter()

# --- pass 2: delivered stages ------------------------------------------------
for svc, g in main_rows:
    cid, stage, n = g["Client__c"], g["StageName"], g["n"]
    if cid not in start:
        skipped["client not on roster"] += n
        continue
    c = cells[(cid, svc, idx(cid, g["y"], g["m"]))]
    c["leads"] += n
    if stage in APPOINTMENT:
        c["appointments"] += n
    if stage in QUOTE_STAGES:
        c["quotes"] += n
    if stage == WON:
        c["pos"] += n

# --- pass 3: quote evidence --------------------------------------------------
# A quote is a quote wherever the record ended up. Only stages that were not
# already counted as quotes are added, so nothing is counted twice. Amounts come
# from here alone, since this pull sees every quote and the delivered pull does
# not.
for g in quote_rows:
    cid, stage, n = g["Client__c"], g["StageName"], g["n"]
    if cid not in start:
        skipped["client not on roster"] += n
        continue
    svc = bucket(cid, g["y"], g["m"])
    c = cells[(cid, svc, idx(cid, g["y"], g["m"]))]
    c["quote_amount"] += g.get("qa") or 0
    if stage not in QUOTE_STAGES:
        c["quotes"] += n
        if stage not in DELIVERED:
            # Never counted at all before: quoted work sitting in a prospecting
            # or follow-up stage. It was plainly delivered.
            c["leads"] += n
            skipped["recovered by quote evidence"] += n

# --- pass 4: PO evidence -----------------------------------------------------
for g in po_rows:
    cid, stage, n = g["Client__c"], g["StageName"], g["n"]
    if cid not in start:
        skipped["client not on roster"] += n
        continue
    svc = bucket(cid, g["y"], g["m"])
    c = cells[(cid, svc, idx(cid, g["y"], g["m"]))]
    c["po_amount"] += g.get("po") or 0
    if stage != WON:
        c["pos"] += n
        if stage not in DELIVERED and stage not in QUOTE_STAGES:
            c["leads"] += n
            skipped["recovered by PO evidence"] += n


def month_start(s, i):
    return datetime.date(s.year + (s.month - 1 + i - 1) // 12,
                         (s.month - 1 + i - 1) % 12 + 1, 1)


results = [{"salesforce_client_id": cid, "service": svc, "month_index": i,
            "month_start": month_start(start[cid], i).isoformat(), **c}
           for (cid, svc, i), c in cells.items()]

bad = [r for r in results if r["month_index"] < 1]
print(f"month_index below 1 (should be none): {len(bad)}")
print(f"clients whose month 1 moved earlier than the recorded date: {moved}")
print(f"clients included with no recorded start date at all:        {no_date}")
print(f"monthly rows  {len(results)}")
print(f"clients       {len({r['salesforce_client_id'] for r in results})}")
print(f"leads {sum(r['leads'] for r in results)}  appts {sum(r['appointments'] for r in results)}"
      f"  quotes {sum(r['quotes'] for r in results)}  pos {sum(r['pos'] for r in results)}")
print(f"quote value {sum(r['quote_amount'] for r in results):,.0f}"
      f"  po value {sum(r['po_amount'] for r in results):,.0f}")
for k, v in skipped.most_common():
    print(f"  {k}: {v}")

if "--dry" in sys.argv or bad:
    sys.exit(0 if not bad else 1)

rest("client_monthly_results?service=neq.__none__", "DELETE", prefer="return=minimal")
for i in range(0, len(results), 500):
    rest("client_monthly_results?on_conflict=salesforce_client_id,service,month_index",
         "POST", results[i:i + 500], prefer="resolution=merge-duplicates,return=minimal")
print(f"loaded {len(results)} rows")
