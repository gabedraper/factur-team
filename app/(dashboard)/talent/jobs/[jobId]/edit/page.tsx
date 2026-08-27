import { notFound } from "next/navigation";
import { requireTalent } from "@/lib/talent/access";
import { getJob, listCompanies, listMembers, listWorkflows } from "@/lib/talent/queries";
import { JobForm } from "@/components/talent/JobForm";
import { PageHeader } from "@/components/talent/bits";

export const dynamic = "force-dynamic";

export default async function EditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  await requireTalent("recruit");
  const { jobId } = await params;

  const [data, { companies }, members, workflows] = await Promise.all([
    getJob(jobId),
    listCompanies({ limit: 500 }),
    listMembers(),
    listWorkflows(),
  ]);
  if (!data) notFound();

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader title={data.job.title} />
      <JobForm
        job={data.job}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        members={members}
        workflows={workflows}
      />
    </div>
  );
}
