import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listMembers, listTeamsAndCoverage, listServicesAndTeams } from "@/lib/org";
import { TeamsScreen } from "@/components/settings/TeamsScreen";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [{ members }, { teams, individualCoverage, clients }, { services }] = await Promise.all([
    listMembers(),
    listTeamsAndCoverage(),
    listServicesAndTeams(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Pods &amp; client coverage</h1>
      </div>

      <TeamsScreen
        services={services}
        teams={teams}
        members={members}
        clients={clients}
        individualCoverage={individualCoverage}
      />
    </div>
  );
}
