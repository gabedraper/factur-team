import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { listClientsForSelf } from "@/actions/self-service";
import { PageHeader, Panel, Empty, Chip, stageTone, AlphaFilter } from "@/components/pipeline/bits";
import { NewOpportunityDialog } from "@/components/pipeline/NewOpportunityDialog";
import { OpportunityListFilters } from "@/components/pipeline/OpportunityListFilters";
import { STAGE_GROUPS, LEAD_STATUSES } from "@/lib/pipeline/picklists";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  stage: string;
  lead_status: string | null;
  next_action_date: string | null;
  crm_contacts: { first_name: string | null; last_name: string | null } | null;
  crm_accounts: { name: string } | null;
};

type Filters = { stage?: string; status?: string; letter?: string; person?: string; company?: string };

function filterHref(clientId: string, patch: Partial<Filters>, current: Filters) {
  const merged = { ...current, ...patch };
  const q = new URLSearchParams();
  if (merged.stage) q.set("stage", merged.stage);
  if (merged.status) q.set("status", merged.status);
  if (merged.letter) q.set("letter", merged.letter);
  if (merged.person) q.set("person", merged.person);
  if (merged.company) q.set("company", merged.company);
  const qs = q.toString();
  return `/opportunities/my/${clientId}${qs ? `?${qs}` : ""}`;
}

export default async function ClientOpportunitiesPage({
  params, searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Filters>;
}) {
  await requirePipeline("view");
  const { clientId } = await params;
  const filters = await searchParams;
  const { stage, status, letter, person, company } = filters;
  const supabase = await createClient();

  const { data: client } = await supabase.from("org_clients").select("id,name").eq("id", clientId).maybeSingle();
  if (!client) notFound();

  // crm_contacts/crm_accounts default to a left-embed so a row with no
  // matched contact still shows -- switched to !inner only when a filter on
  // that embed is active, since !inner is what actually makes ilike() on an
  // embedded column restrict the outer opportunities rows rather than just
  // nulling out the embed for non-matches.
  const contactsJoin = letter || person ? "crm_contacts!inner" : "crm_contacts";
  const accountsJoin = company ? "crm_accounts!inner" : "crm_accounts";

  let query = supabase
    .from("opportunities")
    .select(`id,name,stage,lead_status,next_action_date,${contactsJoin}(first_name,last_name),${accountsJoin}(name)`)
    .eq("client_id", clientId);

  if (stage) query = query.eq("stage", stage);
  if (status) query = query.eq("lead_status", status);
  // With no filter chosen, default to the open pipeline -- this client alone
  // can carry tens of thousands of historical Closed/DQ rows, and that's an
  // archive to filter into on purpose, not the working list.
  if (!stage && !status) query = query.not("stage", "ilike", "Closed:%");
  if (letter) query = query.ilike("crm_contacts.last_name", `${letter}%`);
  if (person) {
    const p = person.trim().replace(/[,()]/g, " ").trim();
    if (p.length >= 2) query = query.or(`first_name.ilike.%${p}%,last_name.ilike.%${p}%`, { foreignTable: "crm_contacts" });
  }
  if (company) {
    const c = company.trim().replace(/[,()]/g, " ").trim();
    if (c.length >= 2) query = query.ilike("crm_accounts.name", `%${c}%`);
  }

  const { data, error } = await query
    .order("next_action_date", { ascending: true, nullsFirst: false })
    .limit(150);
  const rows = (error ? [] : (data as unknown as Row[])) ?? [];

  const clients = await listClientsForSelf();

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link href="/opportunities/my" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> My Opportunities
        </Link>
        <PageHeader title={(client as { name: string }).name} count={rows.length}>
          <NewOpportunityDialog clients={clients} />
        </PageHeader>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Stage</span>
          <Link href={filterHref(clientId, { stage: undefined }, filters)}
                className={`rounded-full border px-2 py-0.5 text-xs ${!stage ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-muted"}`}>
            Open (default)
          </Link>
          {STAGE_GROUPS.flatMap((g) => g.values).map((v) => (
            <Link key={v} href={filterHref(clientId, { stage: v }, filters)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${stage === v ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-muted"}`}>
              {v}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Lead status</span>
          <Link href={filterHref(clientId, { status: undefined }, filters)}
                className={`rounded-full border px-2 py-0.5 text-xs ${!status ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-muted"}`}>
            Any
          </Link>
          {LEAD_STATUSES.map((v) => (
            <Link key={v} href={filterHref(clientId, { status: v }, filters)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${status === v ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-muted"}`}>
              {v}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Contact</span>
          <AlphaFilter
            active={letter ?? null}
            hrefFor={(l) => filterHref(clientId, { letter: l ?? undefined }, filters)}
          />
        </div>
        <OpportunityListFilters />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <Empty>Nothing matches that filter.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Lead status</th>
                <th className="px-4 py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/opportunities/${r.id}`} className="font-medium hover:underline">
                      {[r.crm_contacts?.first_name, r.crm_contacts?.last_name].filter(Boolean).join(" ") || r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.crm_accounts?.name ?? "—"}</td>
                  <td className="px-4 py-2.5"><Chip colour={stageTone(r.stage)}>{r.stage}</Chip></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.lead_status ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{r.next_action_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
