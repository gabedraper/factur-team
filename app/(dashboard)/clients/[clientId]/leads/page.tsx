import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

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
      <div>
        <Link
          href="/clients/health"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Client Health
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {(client as any).name}
          <span className="ml-2 font-normal text-muted-foreground">
            {monthLabel.format(new Date(`${start}T00:00:00Z`))}
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {leads.length.toLocaleString()} leads
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Opportunity</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                  {dayLabel.format(new Date(l.createddate))}
                </td>
                <td className="max-w-xs truncate px-3 py-1.5" title={l.name ?? ""}>
                  {l.name ?? ""}
                </td>
                <td className="max-w-xs truncate px-3 py-1.5">{l.account_name ?? ""}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {l.account_contact_name__c ?? ""}
                  {l.contact_title__c ? `, ${l.contact_title__c}` : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{l.stagename ?? ""}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                  {l.owner_name ?? ""}
                </td>
              </tr>
            ))}
            {!leads.length && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-muted-foreground">
                  {expected
                    ? `${expected} leads are counted for this month, but the lead sync does not cover this client, so the individual records are not here.`
                    : "No leads recorded for this month."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
