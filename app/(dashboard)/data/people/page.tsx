import { requirePipeline } from "@/lib/pipeline/access";
import { listClientsForSelf } from "@/actions/self-service";
import { PageHeader } from "@/components/pipeline/bits";
import { PeopleSearch } from "@/components/data/PeopleSearch";

export const dynamic = "force-dynamic";

export default async function PeopleDataPage() {
  await requirePipeline("view");
  const clients = await listClientsForSelf();

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="People" />
      <PeopleSearch clients={clients} />
    </div>
  );
}
