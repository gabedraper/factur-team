import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { contactCandidates } from "@/actions/sequence-audience";
import { AddContacts } from "@/components/sequences/AddContacts";

export const dynamic = "force-dynamic";

export default async function AddContactsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("sequences.send") && !perms.has("org.manage")) redirect("/");

  const { slug } = await params;
  const contacts = await contactCandidates();

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div>
        <Link
          href={`/sequences/${slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Add contacts</h1>
      </div>
      <AddContacts slug={slug} contacts={contacts} />
    </div>
  );
}
