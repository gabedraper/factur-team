import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { everyRow } from "@/lib/supabase/every-row.mjs";
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
 * Every activity behind one month of the AM Activity card.
 *
 * The card counts these; this is the count opened up, so a number nobody
 * believes can be checked rather than argued about.
 */
export default async function ClientActivitiesPage({
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
  // YYYY-MM only; anything else and there is no month to show.
  if (!month || !/^\d{4}-\d{2}$/.test(month)) notFound();
  const start = `${month}-01`;

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("org_clients")
    .select("name,salesforce_client_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) notFound();

  const { data: roster } = await supabase
    .from("client_roster")
    .select("salesforce_account_id")
    .eq("salesforce_client_id", (client as any).salesforce_client_id)
    .maybeSingle();

  const accountId = (roster as any)?.salesforce_account_id ?? null;

  // Paged, because the API stops at 1,000 rows without saying so; the page
  // still shows at most the first 2,000.
  const rows = accountId
    ? await everyRow(() => supabase
        .from("raw_activities")
        .select("activity_date,activity_type,email_category,subject,owner_name")
        .eq("account_id", accountId)
        .gte("activity_date", start)
        .lt("activity_date", nextMonth(start))
        .order("activity_date", { ascending: false })
        .order("id"))
    : [];

  const activities = (rows as any[]).slice(0, 2000);

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <PageHeader
        back={{ href: "/clients/health", label: "Client Health" }}
        title={<>{(client as any).name}
          <span className="ml-2 font-normal text-muted-foreground">
            {monthLabel.format(new Date(`${start}T00:00:00Z`))}
          </span></>}
        description={<>{activities.length.toLocaleString()} activities
          {activities.length === 2000 && " (first 2,000)"}</>}
      />

      <TableScroll className="rounded-md border">
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH>Direction</TH>
              <TH>Subject</TH>
              <TH>Owner</TH>
            </TR>
          </THead>
          <TBody>
            {activities.map((a, i) => (
              <TR key={i} className="border-t">
                <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {dayLabel.format(new Date(`${a.activity_date}T00:00:00Z`))}
                </TD>
                <TD>{a.activity_type ?? "—"}</TD>
                <TD className="text-muted-foreground">
                  {a.email_category ?? "—"}
                </TD>
                <TD className="max-w-xl truncate" title={a.subject ?? ""}>
                  {a.subject ?? "—"}
                </TD>
                <TD className="whitespace-nowrap text-muted-foreground">
                  {a.owner_name ?? "—"}
                </TD>
              </TR>
            ))}
            {!activities.length && (
              <TR>
                <TD colSpan={5} className="py-4 text-muted-foreground">
                  {accountId
                    ? "No activities recorded for this month."
                    : "This client has no Salesforce account linked, so activities cannot be matched to it."}
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
