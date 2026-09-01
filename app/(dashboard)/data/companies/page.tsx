import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader } from "@/components/pipeline/bits";
import { CompaniesSearch } from "@/components/data/CompaniesSearch";

export const dynamic = "force-dynamic";

export default async function CompaniesDataPage() {
  await requirePipeline("view");

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Companies" />
      <CompaniesSearch />
    </div>
  );
}
