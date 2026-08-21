import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listRolesAndPermissions, listServicesAndTeams } from "@/lib/org";
import { RolesScreen } from "@/components/settings/RolesScreen";

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
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Roles &amp; permissions</h1>
        <p className="text-sm text-muted-foreground">
          What each role is allowed to do. Changes take effect the next time someone loads a page.
        </p>
      </div>
      <RolesScreen roles={roles} permissions={permissions} services={services} />
    </div>
  );
}
