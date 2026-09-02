import Link from "next/link";
import { getNpsByPerson, getNpsCampaigns, getNpsLeads, getNpsResponses, npsOf } from "@/lib/nps/reporting";
import { NpsDashboard } from "@/components/nps/NpsDashboard";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

export default async function NpsPage() {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }

  const [campaigns, leads, people, responses] = await Promise.all([
    getNpsCampaigns(),
    getNpsLeads(),
    getNpsByPerson(),
    getNpsResponses(),
  ]);
  const maySend = perms.has("nps.send") || perms.has("org.manage");

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">NPS</h1>
        {maySend && (
          <Link
            href="/clients/nps/send"
            className="ml-auto h-8 rounded-md border px-3 text-sm leading-8 hover:bg-muted"
          >
            Send surveys
          </Link>
        )}
      </div>
      <NpsDashboard
        campaigns={campaigns}
        leads={leads}
        people={people}
        responses={responses}
        overall={npsOf(responses)}
      />
    </div>
  );
}
