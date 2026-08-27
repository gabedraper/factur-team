import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApplyForm } from "@/components/talent/ApplyForm";
import { place, salaryRange } from "@/lib/talent/format";
import { EMPLOYMENT_TYPE, REMOTE, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

export default async function CareersJobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("tal_public_job", { p_slug: slug });

  const job = (data ?? [])[0] as {
    public_slug: string; title: string; company_name: string | null;
    city: string | null; state: string | null; country: string | null;
    remote: string; employment_type: string; salary_min: number | null;
    salary_max: number | null; salary_currency: string; salary_period: string;
    description: string | null; requirements: string | null;
  } | undefined;

  if (!job) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/careers" className="text-sm text-muted-foreground hover:underline">
        ← All roles
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{job.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {[
          job.company_name,
          place(job.city, job.state, job.country),
          label(REMOTE, job.remote),
          label(EMPLOYMENT_TYPE, job.employment_type),
        ].filter((v) => v && v !== "—").join(" · ")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {salaryRange(job.salary_min, job.salary_max, job.salary_currency, job.salary_period)}
      </p>

      {job.description && (
        <div className="mt-8 whitespace-pre-wrap leading-relaxed">{job.description}</div>
      )}
      {job.requirements && (
        <div className="mt-8">
          <h2 className="text-lg font-medium">Requirements</h2>
          <div className="mt-2 whitespace-pre-wrap leading-relaxed">{job.requirements}</div>
        </div>
      )}

      <div className="mt-12 border-t pt-8">
        <h2 className="text-lg font-medium">Apply</h2>
        <ApplyForm slug={job.public_slug} />
      </div>
    </main>
  );
}
