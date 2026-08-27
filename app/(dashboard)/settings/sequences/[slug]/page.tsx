import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { getSequence } from "@/actions/sequences";
import { SequenceBuilder } from "@/components/sequences/SequenceBuilder";
import { PLACEHOLDERS as COLLECTIONS_FIELDS } from "@/lib/collections/render";
import { PLACEHOLDERS as NPS_FIELDS } from "@/lib/nps/render";

export const dynamic = "force-dynamic";

/*
 * What each process brings of its own: the merge fields it can offer, who the
 * mail comes from, and how far apart new steps usually sit. Everything else is
 * the builder, which is the same for all of them.
 *
 * A survey reminder is only useful while the quarter it asks about is current,
 * which is why its default gap is a week rather than a fortnight.
 */
const PROCESS: Record<string, {
  fields: readonly string[]; senderNote: string; defaultGap: number;
}> = {
  collections: {
    fields: COLLECTIONS_FIELDS,
    senderNote: "Sent from the collections mailbox.",
    defaultGap: 14,
  },
  nps: {
    fields: NPS_FIELDS,
    senderNote: "Sent by each client’s own team lead.",
    defaultGap: 7,
  },
};

export default async function SequencePage({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const perms = await myPermissions();
  const need = slug === "nps" ? "nps.send" : "finance.collections";
  if (!perms.has("org.manage") && !perms.has(need as never)) redirect("/settings");

  const { sequence, steps } = await getSequence(slug);
  if (!sequence) notFound();

  const process = PROCESS[slug] ?? { fields: [], senderNote: "", defaultGap: 7 };

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link
          href="/settings/sequences"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Sequences
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{sequence.name}</h1>
      </div>
      <SequenceBuilder
        sequence={sequence}
        steps={steps}
        placeholders={[...process.fields]}
        senderNote={process.senderNote}
        defaultGap={process.defaultGap}
      />
    </div>
  );
}
