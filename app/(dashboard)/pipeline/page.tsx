import { TargetsPage } from "@/components/pipeline/TargetsPage";

export const dynamic = "force-dynamic";

/*
 * Where the work starts: the companies you are trying to get into, under the
 * people responsible for them.
 *
 * Distinct from /opportunities/my, which lists pursuits -- one row per person
 * being chased. This side is company-first, because that is how the work is
 * actually done: you decide which company to get into, then work out who at it
 * will let you in. RLS decides what is here.
 */
export default function TargetCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; client?: string }>;
}) {
  return <TargetsPage view="companies" searchParams={searchParams} />;
}
