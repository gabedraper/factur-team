import { TargetsPage } from "@/components/pipeline/TargetsPage";

export const dynamic = "force-dynamic";

/*
 * Target Companies read the other way up: the same clients and the same
 * views, and inside each client the people being chased rather than the
 * companies. Companies answers "where do I spend the day". This answers "who
 * do I ring".
 *
 * A static segment under /pipeline sits above [clientId] in Next's matching, so
 * this route wins and no client id can shadow it -- they are uuids in any case.
 */
export default function TargetContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; client?: string }>;
}) {
  return <TargetsPage view="contacts" searchParams={searchParams} />;
}
