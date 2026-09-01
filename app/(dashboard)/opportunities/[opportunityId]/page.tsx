import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Phone, Mail, ClipboardList, StickyNote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { myPermissions } from "@/lib/org";
import { PageHeader, Panel, Empty, Chip, stageTone } from "@/components/pipeline/bits";
import { DialWidget } from "@/components/pipeline/DialWidget";
import { OpportunityEditor } from "@/components/pipeline/OpportunityEditor";

export const dynamic = "force-dynamic";

type Opportunity = {
  id: string;
  name: string;
  stage: string;
  lead_status: string | null;
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
  crm_accounts: { name: string; industry: string | null } | null;
  crm_contacts: { first_name: string | null; last_name: string | null; title: string | null; email: string | null; phone: string | null } | null;
};

type Activity = {
  id: string;
  activity_type: "call" | "email" | "task" | "note";
  subject: string | null;
  body: string | null;
  direction: "inbound" | "outbound" | null;
  outcome: string | null;
  occurred_at: string;
};

const ACTIVITY_ICON = { call: Phone, email: Mail, task: ClipboardList, note: StickyNote };

export default async function OpportunityPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  await requirePipeline("view");
  const { opportunityId } = await params;
  const supabase = await createClient();
  const perms = await myPermissions();

  const [{ data: opp, error }, { data: activities }] = await Promise.all([
    supabase
      .from("opportunities")
      .select(
        "id,name,stage,lead_status,notes,next_action_date,updates," +
        "reached_lead,reached_eval_call_scheduled,reached_selling,reached_discovery,reached_proposal,reached_closing," +
        "org_clients(name),crm_accounts(name,industry),crm_contacts(first_name,last_name,title,email,phone)"
      )
      .eq("id", opportunityId)
      .maybeSingle(),
    supabase
      .from("opp_activities")
      .select("id,activity_type,subject,body,direction,outcome,occurred_at")
      .eq("opportunity_id", opportunityId)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  if (error || !opp) notFound();
  const o = opp as unknown as Opportunity;
  const contactName = [o.crm_contacts?.first_name, o.crm_contacts?.last_name].filter(Boolean).join(" ") || o.name;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <Link href="/opportunities/my" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> My Opportunities
        </Link>
        <PageHeader title={contactName}>
          <Chip colour={stageTone(o.stage)}>{o.stage}</Chip>
          {o.lead_status && <Chip>{o.lead_status}</Chip>}
        </PageHeader>
        <p className="text-sm text-muted-foreground">
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
          <DialWidget
            opportunityId={o.id}
            phoneNumber={o.crm_contacts?.phone ?? null}
            contactName={contactName}
            canAdmin={perms.has("org.manage")}
          />

          <OpportunityEditor
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

          <Panel title="Contact">
            <dl className="space-y-2 p-4 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="tabular-nums">{o.crm_contacts?.phone ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate">{o.crm_contacts?.email ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Industry</dt>
                <dd>{o.crm_accounts?.industry ?? "—"}</dd>
              </div>
            </dl>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Activity">
            {!activities || activities.length === 0 ? (
              <Empty>Nothing logged against this pursuit yet.</Empty>
            ) : (
              <ul className="divide-y">
                {(activities as unknown as Activity[]).map((a) => {
                  const Icon = ACTIVITY_ICON[a.activity_type];
                  return (
                    <li key={a.id} className="flex gap-3 px-4 py-3">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium capitalize">{a.activity_type}</span>
                          {a.direction && <span className="text-xs text-muted-foreground">{a.direction}</span>}
                          {a.outcome && <Chip colour="slate">{a.outcome}</Chip>}
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {new Date(a.occurred_at).toLocaleString()}
                        </span>
                        {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>}
                      </div>
                    </li>
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
