import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { listSequences, sequenceAudience } from "@/actions/sequence-audience";
import { SequenceDetail } from "@/components/sequences/SequenceDetail";

export const dynamic = "force-dynamic";

export default async function SequencePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("sequences.send") && !perms.has("org.manage")) redirect("/");

  const { slug } = await params;
  const [sequences, audience] = await Promise.all([
    listSequences(),
    sequenceAudience(slug),
  ]);

  const sequence = sequences.find((s) => s.slug === slug);
  if (!sequence) notFound();

  /*
   * Asked with the signed-in person's own connection: get_sequence_queue
   * carries the domain gate inline, so the service key would answer with
   * nothing at all rather than with an error.
   */
  const supabase = await createClient();
  const { data: queue } = await supabase.rpc("get_sequence_queue", { p_slug: slug });
  const dueCount = ((queue ?? []) as { subject_type: string }[])
    .filter((q) => q.subject_type === "audience").length;

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div>
        <Link
          href="/sequences"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Sequences
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{sequence.name}</h1>
      </div>
      <SequenceDetail sequence={sequence} audience={audience} dueCount={dueCount} />
    </div>
  );
}
