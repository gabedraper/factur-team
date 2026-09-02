import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { getConversation } from "@/actions/conversation";
import { getBillingSummary } from "@/actions/billing";
import { getClientNotes } from "@/actions/client-notes";
import { Conversation } from "@/components/clients/Conversation";
import { BillingSummary } from "@/components/clients/BillingSummary";
import { Notes } from "@/components/clients/Notes";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

export default async function ClientConversationPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }

  const { clientId } = await params;

  const { data: client } = await createServiceClient()
    .from("org_clients")
    .select("id,name,status")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) notFound();

  const [entries, billing, notes] = await Promise.all([
    getConversation(clientId),
    getBillingSummary(clientId),
    getClientNotes(clientId),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link href="/clients/health" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Client Health
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{(client as { name: string }).name}</h1>
      </div>
      {billing && <BillingSummary summary={billing} />}
      <Notes clientId={clientId} notes={notes} />
      <Conversation entries={entries} />
    </div>
  );
}
