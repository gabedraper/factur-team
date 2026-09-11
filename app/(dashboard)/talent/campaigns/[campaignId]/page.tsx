import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTalent } from "@/lib/talent/access";
import { getCampaign, integrationStatus } from "@/lib/talent/queries";
import { CampaignEditor } from "@/components/talent/CampaignEditor";
import { Chip, Empty, NotConnected, PageHeader, Panel, Stat } from "@/components/talent/bits";
import { ago } from "@/lib/talent/format";
import { Surface } from "@/components/ui/surface";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const access = await requireTalent("view");
  const { campaignId } = await params;

  const [data, gmail, resend] = await Promise.all([
    getCampaign(campaignId), integrationStatus("gmail"), integrationStatus("resend"),
  ]);
  if (!data) notFound();

  const campaign = data.campaign as Record<string, unknown> & {
    id: string; name: string; status: string; mode: string; audience: string;
    tal_jobs: { id: string; title: string } | null;
  };
  const steps = data.steps as never[];
  const sends = data.sends as { status: string }[];
  const queued = sends.filter((s) => s.status === "queued" || s.status === "drafted").length;
  const members = data.members as (Record<string, unknown> & {
    id: string; status: string; current_position: number; enrolled_at: string;
    tal_people: { id: string; name: string; primary_email: string | null; do_not_contact: boolean } | null;
  })[];

  const canSend = gmail.status === "connected" || resend.status === "connected";
  const replied = members.filter((m) => m.status === "replied").length;

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <div>
        <PageHeader title={campaign.name}>
          <Chip colour={campaign.status === "active" ? "emerald" : "slate"}>{campaign.status}</Chip>
        </PageHeader>
        {campaign.tal_jobs && (
          <p className="mt-1 text-sm">
            <Link href={`/talent/jobs/${campaign.tal_jobs.id}`} className="text-primary hover:underline">
              {campaign.tal_jobs.title}
            </Link>
          </p>
        )}
      </div>

      <Surface pad="tight" className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Enrolled" value={members.length} />
        <Stat label="Active" value={members.filter((m) => m.status === "active").length} />
        <Stat label="Replied" value={replied} />
        <Stat label="Steps" value={steps.length} />
        <Stat label="Queued" value={queued} tint={queued ? "text-amber-600 dark:text-amber-400" : undefined} />
      </Surface>

      {!canSend && (
        <NotConnected name={gmail.name} requires={gmail.requires} canAdmin={access.admin} />
      )}

      <CampaignEditor
        campaignId={campaign.id}
        status={campaign.status}
        mode={campaign.mode}
        steps={steps}
        canEdit={access.recruit}
        emailConnected={canSend}
        queued={queued}
      />

      <Panel title="Enrolled">
        {members.length === 0 ? <Empty>Nobody enrolled</Empty> : (
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Email</TH>
                <TH>Status</TH>
                <TH numeric>Step</TH>
                <TH>Enrolled</TH>
              </TR>
            </THead>
            <TBody>
              {members.map((m) => (
                <TR key={m.id}>
                  <TD>
                    {m.tal_people ? (
                      <Link href={`/talent/people/${m.tal_people.id}`} className="hover:underline">
                        {m.tal_people.name}
                      </Link>
                    ) : "—"}
                  </TD>
                  <TD className="text-muted-foreground">{m.tal_people?.primary_email ?? "—"}</TD>
                  <TD>
                    <Chip colour={m.status === "replied" ? "emerald" : m.status === "active" ? "sky" : "slate"}>
                      {m.status}
                    </Chip>
                  </TD>
                  <TD numeric className="text-muted-foreground">
                    {m.current_position < 0 ? "—" : m.current_position + 1}
                  </TD>
                  <TD className="text-muted-foreground">{ago(m.enrolled_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
