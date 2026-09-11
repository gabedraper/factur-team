import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { getNpsQueue, getNpsSettings, getNpsSteps } from "@/actions/nps-sequence";
import { NpsQueue } from "@/components/nps/NpsQueue";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function NpsSendPage() {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }
  if (!perms.has("nps.send") && !perms.has("org.manage")) redirect("/clients/nps");

  const [queue, settings, steps] = await Promise.all([
    getNpsQueue(), getNpsSettings(), getNpsSteps(),
  ]);

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader back={{ href: "/clients/nps", label: "NPS" }} title="Send surveys" />
      <NpsQueue
        queue={queue}
        settings={settings}
        stepsActive={steps.filter((s) => s.active).length}
      />
    </div>
  );
}
