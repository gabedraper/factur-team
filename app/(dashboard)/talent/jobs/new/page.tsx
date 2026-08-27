import { requireTalent } from "@/lib/talent/access";
import { listCompanies, listMembers, listWorkflows } from "@/lib/talent/queries";
import { JobForm } from "@/components/talent/JobForm";
import { PageHeader } from "@/components/talent/bits";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  await requireTalent("recruit");
  const [{ companies }, members, workflows] = await Promise.all([
    listCompanies({ limit: 500 }),
    listMembers(),
    listWorkflows(),
  ]);

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader title="New job" />
      <JobForm
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        members={members}
        workflows={workflows}
      />
    </div>
  );
}
