import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { listSequences } from "@/actions/sequence-audience";
import { SequenceList } from "@/components/sequences/SequenceList";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  const perms = await myPermissions();
  if (!perms.has("sequences.send") && !perms.has("org.manage")) redirect("/");

  const sequences = await listSequences();

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Sequences</h1>
      <SequenceList sequences={sequences} />
    </div>
  );
}
