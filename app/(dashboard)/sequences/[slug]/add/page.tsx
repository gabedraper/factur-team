import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { contactCandidates } from "@/actions/sequence-audience";
import { AddContacts } from "@/components/sequences/AddContacts";
import { PageHeader } from "@/components/ui/page-header";

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
      <PageHeader back={{ href: `/sequences/${slug}`, label: "Back" }} title="Add contacts" />
      <AddContacts slug={slug} contacts={contacts} />
    </div>
  );
}
