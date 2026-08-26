import { getNpsCampaigns, getNpsResponses, npsOf } from "@/lib/nps/reporting";
import { NpsDashboard } from "@/components/nps/NpsDashboard";

export const dynamic = "force-dynamic";

export default async function NpsPage() {
  const [campaigns, responses] = await Promise.all([
    getNpsCampaigns(),
    getNpsResponses(),
  ]);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">NPS</h1>
      <NpsDashboard
        campaigns={campaigns}
        responses={responses}
        overall={npsOf(responses)}
      />
    </div>
  );
}
