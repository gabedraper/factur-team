import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { getNpsQueue, getNpsSettings, getNpsSteps } from "@/actions/nps-sequence";
import { NpsQueue } from "@/components/nps/NpsQueue";
import { NoAccess } from "@/components/no-access";

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
      <div>
        <Link href="/clients/nps" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> NPS
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Send surveys</h1>
      </div>
      <NpsQueue
        queue={queue}
        settings={settings}
        stepsActive={steps.filter((s) => s.active).length}
      />
    </div>
  );
}
