import { redirect } from "next/navigation";
import { myPermissions, listMembers } from "@/lib/org";
import { PeopleTable } from "@/components/settings/PeopleTable";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const { members, roles, services } = await listMembers();

  return (
    <div className="p-6 space-y-4">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="People" />

      <PeopleTable members={members} roles={roles} services={services} />
    </div>
  );
}
