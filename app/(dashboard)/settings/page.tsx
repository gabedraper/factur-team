import Link from "next/link";
import {
  Mail, Users, ShieldCheck, Building2, Link2, Briefcase, SlidersHorizontal,
  MailWarning, Gauge, Contact } from "lucide-react";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { myPermissions, myRealPermissions, listServicesAndTeams } from "@/lib/org";
import { ROLES } from "@/lib/roles";
import { ThemePanel, PreviewPanel } from "@/components/settings/PreferencesPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await myPermissions();
  const canManage = perms.has("org.manage");
  const canEditWeights = perms.has("scoreboard.weights.edit");
  const canRunCollections = perms.has("finance.collections") || canManage;
  // Sequences covers every process now, so anyone who runs one can open it.
  const canEditSequences = canRunCollections || perms.has("nps.send");
  // Preview is offered on what you really hold, not on what you are previewing
  // as -- otherwise stepping into a learner's shoes would strand you there.
  const canPreview = (await myRealPermissions()).has("org.manage");
  const canAdminTalent = perms.has("talent.admin") || canManage;

  const jar = await cookies();
  const previewRole = jar.get("preview_role")?.value ?? null;
  const previewMember = jar.get("preview_member")?.value ?? null;

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

  let people: { id: string; name: string }[] = [];
  if (canPreview) {
    const { data } = await db
      .from("org_members").select("id,full_name,email").eq("active", true).order("full_name");
    people = ((data ?? []) as { id: string; full_name: string | null; email: string }[])
      .map((p) => ({ id: p.id, name: p.full_name ?? p.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
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

      <section className="rounded-md border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Appearance</h2>
        <ThemePanel />
      </section>

      {canPreview && (
        <section className="rounded-md border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium">Preview</h2>
          <PreviewPanel
            roles={Object.entries(ROLES).map(([value, label]) => ({ value, label: label as string }))}
            people={people}
            currentRole={previewRole}
            currentMemberId={previewMember}
          />
        </section>
      )}

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
            <Link href="/settings/roles"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Roles &amp; permissions</span>
                <span className="block text-xs text-muted-foreground">
                  Create roles and choose what each one is allowed to do.
                </span>
              </span>
            </Link>
            {canAdminTalent && (
              <Link href="/settings/talent"
                    className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
                <Contact className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Talent</span>
                  <span className="block text-xs text-muted-foreground">
                    Pipelines and stages, templates, the careers page, and what is connected.
                  </span>
                </span>
              </Link>
            )}
            <Link href="/settings/salesforce"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Salesforce accounts</span>
                <span className="block text-xs text-muted-foreground">
                  Match people to their Salesforce user so activity is attributed correctly.
                </span>
              </span>
            </Link>
            <Link href="/settings/quickbooks"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">QuickBooks customers</span>
                <span className="block text-xs text-muted-foreground">
                  Tie customers who owe money to the right client, where the names differ.
                </span>
              </span>
            </Link>
            <Link href="/settings/performance"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Performance</span>
                <span className="block text-xs text-muted-foreground">
                  Which pages are used, and how long each one takes.
                </span>
              </span>
            </Link>
            <Link href="/settings/google"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Google Workspace</span>
                <span className="block text-xs text-muted-foreground">
                  Check the connection used to read billing mail, chat and meeting transcripts.
                </span>
              </span>
            </Link>
            <Link href="/settings/nps"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">NPS</span>
                <span className="block text-xs text-muted-foreground">
                  Check who a survey can be sent as, and which clients have nobody to ask.
                </span>
              </span>
            </Link>
            {canEditSequences && (
              <Link href="/settings/sequences"
                    className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
                <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Sequences</span>
                  <span className="block text-xs text-muted-foreground">
                    Every process ladder: what goes out, when, and whether it drafts or sends.
                  </span>
                </span>
              </Link>
            )}
            {canEditWeights && (
              <Link href="/admin/weights"
                    className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
                <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Scoring Weights</span>
                  <span className="block text-xs text-muted-foreground">
                    How hustle points and deals are scored.
                  </span>
                </span>
              </Link>
            )}
            <Link href="/settings/clients"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Clients</span>
                <span className="block text-xs text-muted-foreground">
                  Assign each client a service and the pod or person covering it.
                </span>
              </span>
            </Link>
            <Link href="/settings/teams"
                  className="flex items-start gap-3 rounded-md border bg-card p-4 hover:bg-accent transition-colors">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Pods</span>
                <span className="block text-xs text-muted-foreground">
                  Pods, who is in them, and who runs them.
                </span>
              </span>
            </Link>
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
