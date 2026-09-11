import { redirect } from "next/navigation";
import { myPermissions, listMembers } from "@/lib/org";
import { listVoiceNumbers } from "@/actions/dialer";
import { VoiceNumbers } from "@/components/settings/VoiceNumbers";
import { Chip } from "@/components/pipeline/bits";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function DialerSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [numbers, { members }] = await Promise.all([listVoiceNumbers(), listMembers()]);
  const ctiConfigured = Boolean(process.env.NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Dialer"
      />

      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
          <span>Dialpad Mini Dialer (CTI Client ID)</span>
          <Chip colour={ctiConfigured ? "emerald" : "amber"}>{ctiConfigured ? "Configured" : "Not set"}</Chip>
          {!ctiConfigured && (
            <span className="text-muted-foreground">
              Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID</code> once Dialpad issues one.
            </span>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Outbound number pool</h2>
        <VoiceNumbers numbers={numbers} members={members as { id: string; full_name: string | null; email: string }[]} />
      </section>
    </div>
  );
}
