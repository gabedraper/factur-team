import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listMembers } from "@/lib/org";
import { listVoiceNumbers } from "@/actions/dialer";
import { VoiceNumbers } from "@/components/settings/VoiceNumbers";
import { Chip } from "@/components/pipeline/bits";

export const dynamic = "force-dynamic";

export default async function DialerSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [numbers, { members }] = await Promise.all([listVoiceNumbers(), listMembers()]);
  const ctiConfigured = Boolean(process.env.NEXT_PUBLIC_DIALPAD_CTI_CLIENT_ID);
  const twilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET && process.env.TWILIO_TWIML_APP_SID && process.env.TWILIO_AUTH_TOKEN
  );

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Dialer</h1>
        <p className="text-sm text-muted-foreground">
          The click-to-dial widget on an Opportunity uses whichever provider below is configured
          &mdash; Twilio first, Dialpad as the fallback once its Mini Dialer is wired up. Either way,
          what&apos;s below is the outbound number pool the widget rotates through.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
          <span>Twilio Voice SDK</span>
          <Chip colour={twilioConfigured ? "emerald" : "amber"}>{twilioConfigured ? "Configured" : "Not set"}</Chip>
          {!twilioConfigured && (
            <span className="text-muted-foreground">
              Needs <code className="rounded bg-muted px-1">TWILIO_ACCOUNT_SID</code>, <code className="rounded bg-muted px-1">TWILIO_API_KEY_SID</code>,
              <code className="rounded bg-muted px-1">TWILIO_API_KEY_SECRET</code>, <code className="rounded bg-muted px-1">TWILIO_TWIML_APP_SID</code> and
              <code className="rounded bg-muted px-1">TWILIO_AUTH_TOKEN</code>.
            </span>
          )}
        </div>
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
