import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { integrationStatus, listCampaigns, listJobs } from "@/lib/talent/queries";
import { NewCampaign } from "@/components/talent/NewCampaign";
import { Chip, Empty, NotConnected, PageHeader, Panel } from "@/components/talent/bits";
import { ago } from "@/lib/talent/format";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  draft: "slate", active: "emerald", paused: "amber", completed: "indigo", archived: "slate",
};

export default async function CampaignsPage() {
  const access = await requireTalent("view");
  const [campaigns, jobs, gmail, resend] = await Promise.all([
    listCampaigns(), listJobs({ status: "open" }),
    integrationStatus("gmail"), integrationStatus("resend"),
  ]);

  type Row = Record<string, unknown> & {
    id: string; name: string; status: string; audience: string; mode: string;
    created_at: string;
    tal_jobs: { id: string; title: string } | null;
    tal_campaign_steps: { count: number }[];
    tal_campaign_members: { count: number }[];
  };
  const rows = campaigns as Row[];
  const canSend = gmail.status === "connected" || resend.status === "connected";

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Campaigns" count={rows.length}>
        {access.recruit && <NewCampaign jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} />}
      </PageHeader>

      {!canSend && (
        <NotConnected name={gmail.name} requires={gmail.requires} canAdmin={access.admin} />
      )}

      <Panel>
        {rows.length === 0 ? <Empty>No campaigns</Empty> : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Audience</th>
                <th className="px-4 py-2 text-right font-medium">Steps</th>
                <th className="px-4 py-2 text-right font-medium">Enrolled</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/talent/campaigns/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex gap-1.5">
                      <Chip colour={TONE[c.status]}>{c.status}</Chip>
                      <Chip>{c.mode === "full" ? "automatic" : "semi"}</Chip>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {c.tal_jobs ? (
                      <Link href={`/talent/jobs/${c.tal_jobs.id}`} className="hover:underline">
                        {c.tal_jobs.title}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.audience}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.tal_campaign_steps?.[0]?.count ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.tal_campaign_members?.[0]?.count ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ago(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
