#!/usr/bin/env python3
"""
Load the Salesforce half of Client Performance into client_quote_stats.

Quote and win counts, plus each client's decision-maker contact id. Taken from
Salesforce rather than from sf_opp_leads_raw, which carries no quote amount and
no PO fields -- reading it would mean guessing from stage text, which is the
thing Client Performance exists to stop doing.

The other three measures (turnaround, responsiveness, DM involvement) are
computed entirely in the database by refresh_client_performance(), so this
script only has to supply what Salesforce alone knows.

Inputs are the two SOQL pulls whose result files are named below. Re-run them
and update the ids to refresh:

  SELECT Client__c, StageName, COUNT(Id) n FROM Opportunity
   WHERE Client__c != null
     AND Client__r.Client_Status__c IN ('Active','Onboarding')
     AND StageName IN (<the eight quote-path stages>)
   GROUP BY Client__c, StageName

  SELECT Id, Client_Decision_Maker_Contact__c, Client_Contact__c,
         Client_Account__c
    FROM Clients__c WHERE IsDeleted = false ORDER BY Name
"""
import json, glob, sys, urllib.request, collections

TR = ("/Users/gabedraper/.claude/projects/-Users-gabedraper/"
      "3cd72243-f08a-4fa9-bb7a-84816bd37c17/tool-results")
STAGES_FILE = "1788375727813"
CLIENTS_FILE = "1788375791966"


# An RFQ the client has been shown. Every stage on the quote path counts,
# including the ones where they declined or lost -- those are still RFQs they
# were given.
PRESENTED = {
    "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Quoting",
    "Pipeline Hot: Quote Follow up", "Pipeline Hot: Supplier forms / NDA",
    "Pipeline - Selling", "Closed: Closed Won", "Closed: Closed Lost",
    "Closed: No Quote",
}
# Of those, the ones where a quote actually came back. Client RFQ Review means
# it is still sitting with them; No Quote means they declined to bid.
NOT_SUBMITTED = {"Pipeline Hot: Client RFQ Review", "Closed: No Quote"}

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


def records(file_id):
    return json.load(open(glob.glob(f"{TR}/*soqlQuery-{file_id}.txt")[0]))["records"]


stats = collections.defaultdict(
    lambda: dict(presented=0, submitted=0, won=0, lost=0, dm_contact_id=None))

for g in records(STAGES_FILE):
    cid, stage, n = g["Client__c"], g["StageName"], g["n"]
    if stage not in PRESENTED:
        continue
    s = stats[cid]
    s["presented"] += n
    if stage not in NOT_SUBMITTED:
        s["submitted"] += n
    if stage == "Closed: Closed Won":
        s["won"] += n
    elif stage == "Closed: Closed Lost":
        s["lost"] += n

for c in records(CLIENTS_FILE):
    dm = c.get("Client_Decision_Maker_Contact__c")
    if dm:
        stats[c["Id"]]["dm_contact_id"] = dm

rows = [{"salesforce_client_id": cid, **v} for cid, v in stats.items()]

# Only clients the roster knows; a stray id would fail the foreign key anyway
# and is more likely a deleted record than a real one.
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
dropped = [r for r in rows if r["salesforce_client_id"] not in known]
rows = [r for r in rows if r["salesforce_client_id"] in known]

print(f"clients with quote stats  {sum(1 for r in rows if r['presented'])}")
print(f"clients with a DM contact {sum(1 for r in rows if r['dm_contact_id'])}")
print(f"rows                      {len(rows)}   not on roster: {len(dropped)}")

if "--dry" in sys.argv:
    sys.exit(0)

for i in range(0, len(rows), 500):
    rest("client_quote_stats?on_conflict=salesforce_client_id", "POST", rows[i:i + 500],
         prefer="resolution=merge-duplicates,return=minimal")
print(f"loaded {len(rows)} into client_quote_stats")

rest("rpc/refresh_client_performance", "POST", {})
print("refreshed client_performance")
