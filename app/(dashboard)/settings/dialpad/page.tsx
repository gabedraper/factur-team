import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listMembers } from "@/lib/org";
import { listDialpadNumbers } from "@/actions/dialer";
import { DialpadNumbers } from "@/components/settings/DialpadNumbers";
import { Chip } from "@/components/pipeline/bits";

export const dynamic = "force-dynamic";

export default async function DialpadSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [numbers, { members }] = await Promise.all([listDialpadNumbers(), listMembers()]);
  const ctiConfigured = Boolean(process.env.NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Dialpad</h1>
        <p className="text-sm text-muted-foreground">
          The click-to-dial widget on a pipeline pursuit embeds Dialpad&apos;s Mini Dialer directly —
          this app never holds call audio or a Dialpad API key for placing calls. What&apos;s below is
          the outbound number pool that widget rotates through, and whether the widget itself is wired up.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
        <span>Mini Dialer (CTI Client ID)</span>
        <Chip colour={ctiConfigured ? "emerald" : "amber"}>{ctiConfigured ? "Configured" : "Not set"}</Chip>
        {!ctiConfigured && (
          <span className="text-muted-foreground">
            Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID</code> once Dialpad issues one for this integration.
          </span>
        )}
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Outbound number pool</h2>
        <DialpadNumbers numbers={numbers} members={members as { id: string; full_name: string | null; email: string }[]} />
      </section>
    </div>
  );
}
