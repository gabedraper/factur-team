import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTalent } from "@/lib/talent/access";
import { getCampaign, integrationStatus } from "@/lib/talent/queries";
import { CampaignEditor } from "@/components/talent/CampaignEditor";
import { Chip, Empty, NotConnected, PageHeader, Panel, Stat } from "@/components/talent/bits";
import { ago } from "@/lib/talent/format";

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

      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card px-4 py-3 sm:grid-cols-4">
        <Stat label="Enrolled" value={members.length} />
        <Stat label="Active" value={members.filter((m) => m.status === "active").length} />
        <Stat label="Replied" value={replied} />
        <Stat label="Steps" value={steps.length} />
      </div>

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
      />

      <Panel title="Enrolled">
        {members.length === 0 ? <Empty>Nobody enrolled</Empty> : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Step</th>
                <th className="px-4 py-2 font-medium">Enrolled</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2">
                    {m.tal_people ? (
                      <Link href={`/talent/people/${m.tal_people.id}`} className="hover:underline">
                        {m.tal_people.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{m.tal_people?.primary_email ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Chip colour={m.status === "replied" ? "emerald" : m.status === "active" ? "sky" : "slate"}>
                      {m.status}
                    </Chip>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {m.current_position < 0 ? "—" : m.current_position + 1}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{ago(m.enrolled_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
