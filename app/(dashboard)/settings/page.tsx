import Link from "next/link";
import { Users, ShieldCheck, Building2 } from "lucide-react";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions, listServicesAndTeams } from "@/lib/org";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await myPermissions();
  const canManage = perms.has("org.manage");

  const db = createServiceClient();
  const { data: me } = await db
    .from("org_members")
    .select("full_name,email,needs_review,manager_member_id,org_assignments(org_roles(name))")
    .eq("auth_user_id", user?.id ?? "")
    .maybeSingle();

  type Me = {
    full_name: string | null; email: string; manager_member_id: string | null;
    org_assignments?: { org_roles?: { name: string } }[];
  };
  const mine = me as Me | null;
  const roles = (mine?.org_assignments ?? []).map((a) => a.org_roles?.name).filter(Boolean);

  let managerName: string | null = null;
  if (mine?.manager_member_id) {
    const { data: mgr } = await db
      .from("org_members").select("full_name,email").eq("id", mine.manager_member_id).maybeSingle();
    const m = mgr as { full_name: string | null; email: string } | null;
    managerName = m?.full_name ?? m?.email ?? null;
  }

  const { services } = canManage ? await listServicesAndTeams() : { services: [] };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Your account, and — if you administer the app — everyone else&apos;s.</p>
      </div>

      <section className="rounded-md border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">You</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{mine?.full_name ?? "—"}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{mine?.email ?? user?.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{roles.length ? roles.join(", ") : <span className="text-muted-foreground">not set yet</span>}</dd>
          <dt className="text-muted-foreground">Manager</dt>
          <dd>{managerName ?? <span className="text-muted-foreground">not set</span>}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Your name and email come from the Google account you signed in with. Role and manager
          are set by an administrator.
        </p>
      </section>

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Administration</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/settings/people"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">People</span>
                <span className="block text-xs text-muted-foreground">
                  Assign roles and managers. Everyone in the app.
                </span>
              </span>
            </Link>
            <div className="flex items-start gap-3 rounded-md border bg-card p-4">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Services &amp; teams</span>
                <span className="block text-xs text-muted-foreground">
                  {services.length} services, seeded one team each. Editing these is not built yet.
                </span>
              </span>
            </div>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            You see this because you hold the <code>org.manage</code> permission.
          </p>
        </section>
      )}
    </div>
  );
}
