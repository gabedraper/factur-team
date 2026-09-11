import { redirect } from "next/navigation";
import { myPermissions, listMembers, listPodsAndClients } from "@/lib/org";
import { TeamsScreen } from "@/components/settings/TeamsScreen";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [{ members }, { teams }] = await Promise.all([listMembers(), listPodsAndClients()]);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title={<>Pods &amp; client coverage</>}
      />

      <TeamsScreen teams={teams} members={members} />
    </div>
  );
}
