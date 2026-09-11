import { redirect } from "next/navigation";
import { myPermissions, listRolesAndPermissions, listServicesAndTeams } from "@/lib/org";
import { RolesScreen } from "@/components/settings/RolesScreen";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [{ roles, permissions }, { services }] = await Promise.all([
    listRolesAndPermissions(),
    listServicesAndTeams(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title={<>Roles &amp; permissions</>}
      />
      <RolesScreen roles={roles} permissions={permissions} services={services} />
    </div>
  );
}
