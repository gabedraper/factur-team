import { getClientResults } from "@/lib/clients/results";
import { ResultsTable } from "@/components/clients/ResultsTable";
import { clientDomains } from "@/lib/org";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function ClientResultsPage() {
  const perms = await myPermissions();
  if (!perms.has("clients.results") && !perms.has("org.manage")) {
    return <NoAccess section="Client results" need="View client results" />;
  }

  const [clients, domains] = await Promise.all([getClientResults(), clientDomains()]);

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Client Results" />
      <ResultsTable clients={clients} domains={domains} />
    </div>
  );
}
