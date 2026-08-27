import Link from "next/link";
import { getNpsByPerson, getNpsCampaigns, getNpsLeads, getNpsResponses, npsOf } from "@/lib/nps/reporting";
import { NpsDashboard } from "@/components/nps/NpsDashboard";
import { myPermissions } from "@/lib/org";

export const dynamic = "force-dynamic";

export default async function NpsPage() {
  const [campaigns, leads, people, responses, perms] = await Promise.all([
    getNpsCampaigns(),
    getNpsLeads(),
    getNpsByPerson(),
    getNpsResponses(),
    myPermissions(),
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
