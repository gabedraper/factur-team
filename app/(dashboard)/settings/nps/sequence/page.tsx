import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { getNpsSteps, getNpsSettings } from "@/actions/nps-sequence";
import { NpsSequence } from "@/components/nps/NpsSequence";

export const dynamic = "force-dynamic";

export default async function NpsSequencePage() {
  const perms = await myPermissions();
  if (!perms.has("nps.send") && !perms.has("org.manage")) redirect("/settings");

  const [steps, settings] = await Promise.all([getNpsSteps(), getNpsSettings()]);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link
          href="/clients/nps"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> NPS
        </Link>
        <h1 className="mt-1 text-xl font-semibold">NPS Sequence</h1>
      </div>
      <NpsSequence steps={steps} settings={settings} />
    </div>
  );
}
