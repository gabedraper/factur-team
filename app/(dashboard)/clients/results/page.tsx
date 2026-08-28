import { getClientResults } from "@/lib/clients/results";
import { ResultsTable } from "@/components/clients/ResultsTable";

export const dynamic = "force-dynamic";

export default async function ClientResultsPage() {
  const clients = await getClientResults();

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Client Results</h1>
      <ResultsTable clients={clients} />
    </div>
  );
}
