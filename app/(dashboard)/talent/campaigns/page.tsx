import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { integrationStatus, listCampaigns, listJobs } from "@/lib/talent/queries";
import { NewCampaign } from "@/components/talent/NewCampaign";
import { Chip, Empty, NotConnected, PageHeader, Panel } from "@/components/talent/bits";
import { ago } from "@/lib/talent/format";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

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
          <Table>
            <THead>
              <TR>
                <TH>Campaign</TH>
                <TH>Job</TH>
                <TH>Audience</TH>
                <TH numeric>Steps</TH>
                <TH numeric>Enrolled</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id} >
                  <TD>
                    <Link href={`/talent/campaigns/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex gap-1.5">
                      <Chip colour={TONE[c.status]}>{c.status}</Chip>
                      <Chip>{c.mode === "full" ? "automatic" : "semi"}</Chip>
                    </div>
                  </TD>
                  <TD className="text-muted-foreground">
                    {c.tal_jobs ? (
                      <Link href={`/talent/jobs/${c.tal_jobs.id}`} className="hover:underline">
                        {c.tal_jobs.title}
                      </Link>
                    ) : "—"}
                  </TD>
                  <TD className="text-muted-foreground">{c.audience}</TD>
                  <TD numeric>
                    {c.tal_campaign_steps?.[0]?.count ?? 0}
                  </TD>
                  <TD numeric>
                    {c.tal_campaign_members?.[0]?.count ?? 0}
                  </TD>
                  <TD className="text-muted-foreground">{ago(c.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
