import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Phone, Mail, ClipboardList, StickyNote, CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { readsField } from "@/lib/pipeline/ladder";
import { myLadder } from "@/lib/pipeline/ladder-server";
import { PageHeader, Panel, Empty, Chip, stageTone } from "@/components/pipeline/bits";
import { RegisterActiveOpportunity } from "@/components/work-panel/RegisterActiveOpportunity";
import { OpportunityEditor } from "@/components/pipeline/OpportunityEditor";
import { ContactEditor } from "@/components/pipeline/ContactEditor";
import { PotentialDuplicates, type Duplicate } from "@/components/pipeline/PotentialDuplicates";

export const dynamic = "force-dynamic";

type Opportunity = {
  id: string;
  name: string;
  stage: string;
  lead_status: string | null;
  is_duplicate: boolean;
  notes: string | null;
  next_action_date: string | null;
  updates: string | null;
  reached_lead: boolean;
  reached_eval_call_scheduled: boolean;
  reached_selling: boolean;
  reached_discovery: boolean;
  reached_proposal: boolean;
  reached_closing: boolean;
  org_clients: { name: string } | null;
  crm_accounts: { name: string; industry: string | null; domain: string | null } | null;
  crm_contacts: { first_name: string | null; last_name: string | null; title: string | null; email: string | null; phone: string | null; linkedin_url: string | null } | null;
};

type Activity = {
  id: string;
  activity_type: "call" | "email" | "task" | "note" | "meeting";
  subject: string | null;
  body: string | null;
  direction: "inbound" | "outbound" | null;
  outcome: string | null;
  occurred_at: string;
  org_members: { full_name: string | null } | null;
};

const ACTIVITY_ICON = { call: Phone, email: Mail, task: ClipboardList, note: StickyNote, meeting: CalendarDays };

/*
 * One line per activity: who did what, then the subject, then the date. The
 * thread used to print every email in full -- signature, tracking links and
 * the quoted reply underneath -- so three emails filled the panel. The body
 * is still there, a click away.
 *
 * Who did it comes from Salesforce's logging conventions rather than a field:
 * an email logged as "Sent (Reply): ..." was sent by the rep, "Replied: ..."
 * was the prospect writing back, and either way the task's owner is the rep.
 * Calls carry a direction; a meeting is named by its subject; a task from
 * Salesforce's field tracking reads as the change it recorded.
 */
function activityLine(a: Activity, rep: string, prospect: string): { who: string; verb: string; subject: string | null } {
  const subject = a.subject ?? "";
  const strip = (prefix: RegExp) => subject.replace(prefix, "").trim() || null;
  switch (a.activity_type) {
    case "email":
      if (/^Replied\b/i.test(subject)) return { who: prospect, verb: "replied", subject: strip(/^Replied:?\s*/i) };
      if (/^Sent\b/i.test(subject)) return { who: rep, verb: "emailed", subject: strip(/^Sent\s*\([^)]*\)\s*(\[[^\]]*\])?:?\s*/i) };
      return { who: rep, verb: "emailed", subject: subject || null };
    case "call": {
      const minutes = subject.match(/(\d+)\s*min/i)?.[1];
      const length = minutes ? `${minutes} min` : null;
      if (a.direction === "inbound") return { who: prospect, verb: "called", subject: length ?? a.outcome };
      if (/missed/i.test(subject)) return { who: rep, verb: "called, no answer", subject: null };
      return { who: rep, verb: "called", subject: length ?? (subject.startsWith("Dialpad") ? null : subject) };
    }
    case "meeting":
      return { who: subject || "Meeting", verb: "", subject: null };
    default: {
      const change = subject.match(/^Field Change\s+(.+?):\s*(.+)$/i);
      if (change) return { who: rep, verb: `set ${change[1].toLowerCase()}`, subject: change[2] };
      return { who: rep, verb: a.activity_type === "note" ? "noted" : "logged a task", subject: subject || null };
    }
  }
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

export default async function OpportunityPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  await requirePipeline("view");
  const { opportunityId } = await params;
  const supabase = await createClient();

  const [{ data: opp, error }, { data: activities }, ladder, { data: duplicates }] = await Promise.all([
    supabase
      .from("opportunities")
      .select(
        "id,name,stage,lead_status,is_duplicate,notes,next_action_date,updates," +
        "reached_lead,reached_eval_call_scheduled,reached_selling,reached_discovery,reached_proposal,reached_closing," +
        "org_clients(name),crm_accounts(name,industry,domain),crm_contacts(first_name,last_name,title,email,phone,linkedin_url)"
      )
      .eq("id", opportunityId)
      .maybeSingle(),
    supabase
      .from("opp_activities")
      .select("id,activity_type,subject,body,direction,outcome,occurred_at,org_members(full_name)")
      .eq("opportunity_id", opportunityId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    myLadder(),
    /* The rest of this client's records against this contact, as the viewer
       may see them. Empty for the common case, one row per sibling otherwise. */
    supabase.rpc("opportunity_duplicates", { p_id: opportunityId }),
  ]);

  if (error || !opp) notFound();
  const o = opp as unknown as Opportunity;
  const contactName = [o.crm_contacts?.first_name, o.crm_contacts?.last_name].filter(Boolean).join(" ") || o.name;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <RegisterActiveOpportunity
        opportunityId={o.id}
        phoneNumber={o.crm_contacts?.phone ?? null}
        contactName={contactName}
      />
      <div>
        <Link href="/opportunities/my" className="inline-flex items-center gap-1 text-body text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> My Opportunities
        </Link>
        {/* The progress the viewer's own ladder reports. Both, for somebody
            who reads both; a BDM sees only the lead status. */}
        <PageHeader title={contactName}>
          {readsField(ladder, "stage") && <Chip colour={stageTone(o.stage)}>{o.stage}</Chip>}
          {readsField(ladder, "lead_status") && o.lead_status && <Chip>{o.lead_status}</Chip>}
        </PageHeader>
        <p className="text-body text-muted-foreground">
          {[o.crm_contacts?.title, o.crm_accounts?.name, o.org_clients?.name && `for ${o.org_clients.name}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* Fields in the middle, activity feed on the right -- same shape as a
          Salesforce record page, so the layout is legible to anyone coming
          from there. */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <OpportunityEditor
            ladder={ladder}
            opportunity={{
              id: o.id,
              stage: o.stage,
              lead_status: o.lead_status,
              notes: o.notes,
              next_action_date: o.next_action_date,
              updates: o.updates,
              reached_lead: o.reached_lead,
              reached_eval_call_scheduled: o.reached_eval_call_scheduled,
              reached_selling: o.reached_selling,
              reached_discovery: o.reached_discovery,
              reached_proposal: o.reached_proposal,
              reached_closing: o.reached_closing,
            }}
          />

          <ContactEditor
            opportunityId={o.id}
            contactName={contactName}
            phone={o.crm_contacts?.phone ?? null}
            email={o.crm_contacts?.email ?? null}
            linkedinUrl={o.crm_contacts?.linkedin_url ?? null}
            title={o.crm_contacts?.title ?? null}
            company={o.crm_accounts?.name ?? null}
            industry={o.crm_accounts?.industry ?? null}
            domain={o.crm_accounts?.domain ?? null}
          />
        </div>

        <div className="space-y-4">
          <PotentialDuplicates
            rows={((duplicates ?? []) as Duplicate[])}
            isMain={!o.is_duplicate}
            ladder={ladder}
          />
          <Panel title="Activity">
            {!activities || activities.length === 0 ? (
              <Empty>Nothing logged against this opportunity yet.</Empty>
            ) : (
              <ul className="divide-y">
                {(activities as unknown as Activity[]).map((a) => {
                  const Icon = ACTIVITY_ICON[a.activity_type] ?? ClipboardList;
                  const rep = a.org_members?.full_name ?? "Factur";
                  const line = activityLine(a, rep, contactName);
                  const row = (
                    <span className="flex min-w-0 flex-1 items-baseline gap-2 text-body">
                      <Icon className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden />
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{line.who}</span>
                        {line.verb && <span> {line.verb}</span>}
                        {line.subject && <span className="text-muted-foreground"> · {line.subject}</span>}
                      </span>
                      <span className="ml-auto shrink-0 text-meta tabular-nums text-muted-foreground">
                        {shortDate(a.occurred_at)}
                      </span>
                    </span>
                  );
                  /* Native details: the line is the summary, the body opens
                     under it, no script and no state to lose on a refresh. */
                  return a.body ? (
                    <li key={a.id}>
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center px-4 py-2 transition-colors duration-fast ease-out hover:bg-card-hover [&::-webkit-details-marker]:hidden">
                          {row}
                        </summary>
                        <p className="max-h-96 overflow-y-auto whitespace-pre-wrap px-4 pb-3 pl-11 text-meta text-muted-foreground">
                          {a.body}
                        </p>
                      </details>
                    </li>
                  ) : (
                    <li key={a.id} className="flex items-center px-4 py-2">{row}</li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
