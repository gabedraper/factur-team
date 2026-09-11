import Link from "next/link";
import {
  Users, ShieldCheck, Building2, Layers, Briefcase, SlidersHorizontal,
  MailWarning, Gauge, Contact, Bot, Plug, Phone, FileSignature, Palette, UploadCloud} from "lucide-react";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { myPermissions, myRealPermissions, listServicesAndTeams } from "@/lib/org";
import { ThemePanel, PreviewPanel } from "@/components/settings/PreferencesPanel";
import { SelfServicePanel } from "@/components/settings/SelfServicePanel";
import { listClientsForSelf, listRolesForSelf } from "@/actions/self-service";
import { PageHeader } from "@/components/ui/page-header";
import { Surface, surface } from "@/components/ui/surface";

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
  const previewMember = jar.get("preview_member")?.value ?? null;

  const db = createServiceClient();
  const { data: me } = await db
    .from("org_members")
    .select("id,full_name,email,needs_review,manager_member_id,org_assignments(role_id,org_roles(name))")
    .eq("auth_user_id", user?.id ?? "")
    .maybeSingle();

  type Me = {
    id: string; full_name: string | null; email: string; manager_member_id: string | null;
    org_assignments?: { role_id: string; org_roles?: { name: string } }[];
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

  const { services } = await listServicesAndTeams();

  /*
   * Anyone may now set their own role and take clients, so the pickers are
   * built for everybody rather than behind the administration section.
   */
  const [{ roles: selfRoles, canAssignRestricted }, myClients] = await Promise.all([
    listRolesForSelf(),
    listClientsForSelf(),
  ]);

  // Already fetched above with the rest of this person's own record.
  const myRoleId = mine?.org_assignments?.[0]?.role_id ?? null;

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
        <PageHeader title="Settings" />
      </div>

      <Surface as="section" className="space-y-3">
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
        <SelfServicePanel
          roles={selfRoles}
          services={services}
          currentRoleId={myRoleId}
          clients={myClients}
          canAssignRestricted={canAssignRestricted}
        />
      </Surface>

      <Surface as="section" className="space-y-3">
        <h2 className="text-sm font-medium">Appearance</h2>
        <ThemePanel />
      </Surface>

      {canPreview && (
        <Surface as="section" className="space-y-3">
          <h2 className="text-sm font-medium">Preview</h2>
          <PreviewPanel
            people={people}
            currentMemberId={previewMember}
          />
        </Surface>
      )}

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Administration</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/settings/people"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">People</span>
                <span className="block text-xs text-muted-foreground">
                  Assign roles and managers. Everyone in the app.
                </span>
              </span>
            </Link>
            <Link href="/settings/roles"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
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
                    className={`${surface({ interactive: true })} flex items-start gap-3`}>
                <Contact className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Talent</span>
                  <span className="block text-xs text-muted-foreground">
                    Pipelines and stages, templates, the careers page, and what is connected.
                  </span>
                </span>
              </Link>
            )}
            <Link href="/integrations"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Plug className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Integrations</span>
                <span className="block text-xs text-muted-foreground">
                  Where the data comes from, what each sync takes, and when it last ran.
                </span>
              </span>
            </Link>
            <Link href="/settings/agreements"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Signed agreements</span>
                <span className="block text-xs text-muted-foreground">
                  Bring contracts in from PandaDoc and tie them to the right client.
                </span>
              </span>
            </Link>
            <Link href="/settings/salesforce-writeback"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <UploadCloud className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Salesforce write-back</span>
                <span className="block text-xs text-muted-foreground">
                  Whose app edits are pushed to Salesforce, and every field that went.
                </span>
              </span>
            </Link>
            <Link href="/settings/dialpad"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Dialpad</span>
                <span className="block text-xs text-muted-foreground">
                  The click-to-dial widget&apos;s outbound number pool, and whether it&apos;s wired up.
                </span>
              </span>
            </Link>
            <Link href="/settings/design"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Palette className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Design reference</span>
                <span className="block text-xs text-muted-foreground">
                  Every shared component, in both themes.
                </span>
              </span>
            </Link>
            <Link href="/settings/performance"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Performance</span>
                <span className="block text-xs text-muted-foreground">
                  Which pages are used, and how long each one takes.
                </span>
              </span>
            </Link>
            <Link href="/settings/agents"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Agents</span>
                <span className="block text-xs text-muted-foreground">
                  Gaib and any other assistants: what they are told, what they can read, who can use them.
                </span>
              </span>
            </Link>
            <Link href="/settings/nps"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
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
                    className={`${surface({ interactive: true })} flex items-start gap-3`}>
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
                    className={`${surface({ interactive: true })} flex items-start gap-3`}>
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
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Clients</span>
                <span className="block text-xs text-muted-foreground">
                  Assign each client a service and the pod or person covering it.
                </span>
              </span>
            </Link>
            <Link href="/settings/teams"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Pods</span>
                <span className="block text-xs text-muted-foreground">
                  Pods, who is in them, and who runs them.
                </span>
              </span>
            </Link>
            <Link href="/settings/services"
                  className={`${surface({ interactive: true })} flex items-start gap-3`}>
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Services</span>
                <span className="block text-xs text-muted-foreground">
                  The list behind the Service dropdown on a client.
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
