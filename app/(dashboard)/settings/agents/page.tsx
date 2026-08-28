import Link from "next/link";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { listAgents } from "@/lib/gaib/agents";
import { TOOLS } from "@/lib/gaib/tools";
import { AgentsHub } from "@/components/settings/AgentsHub";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  if (!(await myPermissions()).has("org.manage")) redirect("/settings");

  const db = createServiceClient();
  const { data: roleRows } = await db
    .from("org_roles").select("id,name").order("name");

  const agents = await listAgents();
  const roles = (roleRows ?? []) as { id: string; name: string }[];

  // The registry is the source of truth for what a tool is; the hub only picks
  // from it. Passed down as plain data so the editor never imports the tools
  // themselves into the browser bundle.
  const tools = TOOLS.map((t) => ({
    name: t.name, label: t.label, blurb: t.blurb, reads: t.reads ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Agents</h1>
        <Link
          href="/settings/agents/coding"
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Wrench className="h-4 w-4" />
          Coding agent
        </Link>
      </div>

      <AgentsHub agents={agents} roles={roles} tools={tools} />
    </div>
  );
}
