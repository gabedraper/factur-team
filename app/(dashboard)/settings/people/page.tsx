import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listMembers } from "@/lib/org";
import { PeopleTable } from "@/components/settings/PeopleTable";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const { members, roles } = await listMembers();

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">People</h1>
      </div>

      <PeopleTable members={members} roles={roles} />
    </div>
  );
}
