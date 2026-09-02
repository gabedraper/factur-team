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

  const { data: rows } = accountId
    ? await supabase
        .from("raw_activities")
        .select("activity_date,activity_type,email_category,subject,owner_name")
        .eq("account_id", accountId)
        .gte("activity_date", start)
        .lt("activity_date", nextMonth(start))
        .order("activity_date", { ascending: false })
        .limit(2000)
    : { data: [] };

  const activities = (rows ?? []) as any[];

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
          {activities.length.toLocaleString()} activities
          {activities.length === 2000 && " (first 2,000)"}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Direction</th>
              <th className="px-3 py-2 font-medium">Subject</th>
              <th className="px-3 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((a, i) => (
              <tr key={i} className="border-t">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                  {dayLabel.format(new Date(`${a.activity_date}T00:00:00Z`))}
                </td>
                <td className="px-3 py-1.5">{a.activity_type ?? "—"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {a.email_category ?? "—"}
                </td>
                <td className="max-w-xl truncate px-3 py-1.5" title={a.subject ?? ""}>
                  {a.subject ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                  {a.owner_name ?? "—"}
                </td>
              </tr>
            ))}
            {!activities.length && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                  {accountId
                    ? "No activities recorded for this month."
                    : "This client has no Salesforce account linked, so activities cannot be matched to it."}
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
