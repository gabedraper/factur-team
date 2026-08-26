import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { npsCoverage } from "@/actions/nps-readiness";
import { getNpsSettings, getNpsSteps } from "@/actions/nps-sequence";
import { NpsReadiness } from "@/components/nps/NpsReadiness";
import { NpsSequence } from "@/components/nps/NpsSequence";

export const dynamic = "force-dynamic";

export default async function NpsSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [coverage, steps, settings] = await Promise.all([
    npsCoverage(), getNpsSteps(), getNpsSettings(),
  ]);

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">NPS</h1>
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Sequence
        </h2>
        <NpsSequence steps={steps} settings={settings} />
      </section>
      <NpsReadiness coverage={coverage} />
    </div>
  );
}
