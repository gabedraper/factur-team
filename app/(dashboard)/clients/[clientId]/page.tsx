import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { getConversation } from "@/actions/conversation";
import { getBillingSummary } from "@/actions/billing";
import { Conversation } from "@/components/clients/Conversation";
import { BillingSummary } from "@/components/clients/BillingSummary";

export const dynamic = "force-dynamic";

export default async function ClientConversationPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const { data: client } = await createServiceClient()
    .from("org_clients")
    .select("id,name,status")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) notFound();

  const [entries, billing] = await Promise.all([
    getConversation(clientId),
    getBillingSummary(clientId),
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
      <Conversation entries={entries} />
    </div>
  );
}
