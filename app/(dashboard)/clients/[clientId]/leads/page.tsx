import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "long", year: "numeric", timeZone: "UTC",
});
const dayLabel = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The leads behind one month of the Lead Flow card.
 *
 * Every lead generated for the client that month -- long-term follow up and
 * all -- less the Prospecting: family, which is sourcing rather than a lead.
 * Same rule the count uses, so the rows here add up to the number on the card.
 * Where each one ended up is a question for funnel conversion tracking.
 */
export default async function ClientLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }

  const [{ clientId }, { month }] = await Promise.all([params, searchParams]);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) notFound();
  const start = `${month}-01`;

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("org_clients")
    .select("name,salesforce_client_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) notFound();

  const salesforceId = (client as any).salesforce_client_id as string | null;

  const [{ data: rows }, { data: counted }] = await Promise.all([
    salesforceId
      ? supabase
          .from("sf_opp_leads_raw")
          .select("name,stagename,createddate,account_name,account_contact_name__c,contact_title__c,owner_name")
          .eq("client__c", salesforceId)
          // Same rule the count uses, so the rows here add up to the card.
          .not("stagename", "like", "Prospecting:%")
          .gte("createddate", start)
          .lt("createddate", nextMonth(start))
          .order("createddate", { ascending: false })
          .limit(2000)
      : { data: [] },
    supabase
      .from("client_lead_months_by_client")
      .select("leads")
      .eq("client_id", clientId)
      .eq("month_start", start)
      .maybeSingle(),
  ]);

  const leads = (rows ?? []) as any[];
  const expected = (counted as any)?.leads ?? null;

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <PageHeader
        back={{ href: "/clients/health", label: "Client Health" }}
        title={<>{(client as any).name}
          <span className="ml-2 font-normal text-muted-foreground">
            {monthLabel.format(new Date(`${start}T00:00:00Z`))}
          </span></>}
        description={<>{leads.length.toLocaleString()} leads</>}
      />

      <TableScroll className="rounded-md border">
        <Table>
          <THead>
            <TR>
              <TH>Created</TH>
              <TH>Opportunity</TH>
              <TH>Company</TH>
              <TH>Contact</TH>
              <TH>Stage</TH>
              <TH>Owner</TH>
            </TR>
          </THead>
          <TBody>
            {leads.map((l, i) => (
              <TR key={i} className="border-t">
                <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {dayLabel.format(new Date(l.createddate))}
                </TD>
                <TD className="max-w-xs truncate" title={l.name ?? ""}>
                  {l.name ?? ""}
                </TD>
                <TD className="max-w-xs truncate">{l.account_name ?? ""}</TD>
                <TD className="text-muted-foreground">
                  {l.account_contact_name__c ?? ""}
                  {l.contact_title__c ? `, ${l.contact_title__c}` : ""}
                </TD>
                <TD className="whitespace-nowrap">{l.stagename ?? ""}</TD>
                <TD className="whitespace-nowrap text-muted-foreground">
                  {l.owner_name ?? ""}
                </TD>
              </TR>
            ))}
            {!leads.length && (
              <TR>
                <TD colSpan={6} className="py-4 text-muted-foreground">
                  {expected
                    ? `${expected} leads are counted for this month, but the lead sync does not cover this client, so the individual records are not here.`
                    : "No leads recorded for this month."}
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </TableScroll>
    </div>
  );
}

/** First day of the month after the one given. */
function nextMonth(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}
