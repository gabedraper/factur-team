import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { getAuthedUser, getProfile } from "@/lib/supabase/session";
import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";
import {
  BookOpen,
  LayoutDashboard,
  Users,
  Map,
  GraduationCap,
  Award,
  LogOut,
  BarChart2,
  ClipboardList,
  Trophy,
  Target,
  SlidersHorizontal,
  Activity,
  Handshake,
  Repeat,
  Zap,
  CalendarClock,
  HeartPulse,
  Gauge,
  MailWarning,
  Home,
  Briefcase,
  Contact,
  Building2,
  KanbanSquare,
  Radar,
  Send,
  CalendarDays,
  BadgeCheck,
  LineChart,
  Coins,
  MessageCircle,
} from "lucide-react";
import { getRoleLabel } from "@/lib/roles";
import { GaibWidget } from "@/components/gaib/gaib-widget";
import { AppSidebar, type NavGroup, type NavItem } from "@/components/app-sidebar";
import { PreviewBanner } from "@/components/preview-banner";
import { MaintenanceAlert } from "@/components/maintenance-alert";
import { OnlineUsers } from "@/components/online-users";
import { previewedMember, myPermissions, myRealPermissions, myRoleLabel } from "@/lib/org";
import { getCollectionsVisibility } from "@/actions/collections";
import { PageTiming } from "@/components/PageTiming";

function getNavGroups(perms: Set<string>, collections: boolean): NavGroup[] {
  const groups: NavGroup[] = [];

  // Built from what someone may do, so adding a permission to a role in
  // Settings changes their navigation -- no second list to keep in step.
  const learn: NavItem[] = [];
  if (perms.has("lms.admin")) {
    learn.push(
      { href: "/admin", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
      { href: "/admin/enrollments", label: "Enrollments", icon: <ClipboardList className="h-4 w-4" /> },
      { href: "/admin/role-training", label: "Role Training", icon: <Map className="h-4 w-4" /> },
      { href: "/admin/courses", label: "All Courses", icon: <BookOpen className="h-4 w-4" /> },
    );
  }
  if (perms.has("lms.learn")) {
    learn.push(
      { href: "/learner", label: "My Training", icon: <GraduationCap className="h-4 w-4" /> },
      { href: "/learner/certificates", label: "Certificates", icon: <Award className="h-4 w-4" /> },
      { href: "/leaderboard", label: "Leaderboard", icon: <Trophy className="h-4 w-4" /> },
    );
  }
  // Training progress is open to the whole company, like the scoreboards, so it
  // is not gated on anything.
  learn.push({ href: "/progress", label: "Team Progress", icon: <BarChart2 className="h-4 w-4" /> });

  if (learn.length) groups.push({ label: "Learn", items: learn });

  const scoreboard: NavItem[] = [];
  if (perms.has("scoreboard.view")) {
    scoreboard.push(
      { href: "/scoreboard/hustle-points", label: "Hustle Points", icon: <Target className="h-4 w-4" /> },
      { href: "/scoreboard/deals", label: "Deals", icon: <Handshake className="h-4 w-4" /> },
      { href: "/scoreboard/retention", label: "Retention", icon: <Repeat className="h-4 w-4" /> },
    );
  }
  if (scoreboard.length) groups.push({ label: "Scoreboard", items: scoreboard });

  if (perms.has("clients.health") || collections) {
    const clients: NavItem[] = [];
    if (perms.has("clients.health")) {
      clients.push({ href: "/clients/health", label: "Client Health", icon: <HeartPulse className="h-4 w-4" /> });
      clients.push({ href: "/clients/nps", label: "NPS", icon: <Gauge className="h-4 w-4" /> });
    }
    if (collections) {
      clients.push({ href: "/collections", label: "Collections", icon: <MailWarning className="h-4 w-4" /> });
    }
    groups.push({ label: "Clients", items: clients });
  }

  /*
   * Talent is a section rather than a page -- it is an applicant tracker and a
   * recruiting CRM, and neither fits behind one link. The order follows the way
   * the work runs: what is on today, the searches, the database behind them,
   * then outreach, then what came of it.
   */
  const talent: NavItem[] = [];
  if (perms.has("talent.view") || perms.has("talent.recruit") || perms.has("talent.admin")) {
    talent.push(
      { href: "/talent", label: "Today", icon: <Home className="h-4 w-4" /> },
      { href: "/talent/jobs", label: "Jobs", icon: <Briefcase className="h-4 w-4" /> },
      { href: "/talent/people", label: "People", icon: <Contact className="h-4 w-4" /> },
      { href: "/talent/companies", label: "Companies", icon: <Building2 className="h-4 w-4" /> },
      { href: "/talent/pipeline", label: "Pipeline", icon: <KanbanSquare className="h-4 w-4" /> },
      { href: "/talent/sourcing", label: "Sourcing", icon: <Radar className="h-4 w-4" /> },
      { href: "/talent/campaigns", label: "Campaigns", icon: <Send className="h-4 w-4" /> },
      { href: "/talent/schedule", label: "Schedule", icon: <CalendarDays className="h-4 w-4" /> },
      { href: "/talent/deals", label: "Deals", icon: <Coins className="h-4 w-4" /> },
      { href: "/talent/placements", label: "Placements", icon: <BadgeCheck className="h-4 w-4" /> },
      { href: "/talent/reports", label: "Reports", icon: <LineChart className="h-4 w-4" /> },
    );
    groups.push({ label: "Talent", items: talent });
  }

  // Only whoever decides on the tickets needs the list of them; everyone else
  // reaches Gaib through the button in the footer.
  if (perms.has("org.manage")) {
    groups.push({
      label: "Gaib",
      items: [
        { href: "/gaib", label: "Tickets", icon: <MessageCircle className="h-4 w-4" /> },
      ],
    });
  }

  if (perms.has("timelines.view")) {
    groups.push({
      label: "Opportunity Timelines",
      items: [
        { href: "/timelines/quick-response", label: "Lead Response", icon: <Zap className="h-4 w-4" /> },
        { href: "/timelines/follow-up", label: "Lead follow up", icon: <CalendarClock className="h-4 w-4" /> },
        { href: "/timelines/full-life", label: "Full lead life", icon: <Activity className="h-4 w-4" /> },
      ],
    });
  }

  return groups;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthedUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await getProfile(user.id);

  // Signing in with a non-Factur Google account produces a session but no
  // profile, since handle_new_user only creates one for the allowed domains.
  // Checked here rather than in middleware, where it cost a database round trip
  // on every request in the app.
  if (!profile) {
    redirect("/unauthorized");
  }

  // Role preview is honoured on the *real* rights, not on profiles.role -- that
  // column no longer decides anything, so someone granted org.manage in Settings
  // could set the cookie and then have it quietly ignored here.
  /*
   * Asked together rather than one after another.
   *
   * None of these needs any of the others -- they were sequential only because
   * that is how they were written, and the page could not start rendering
   * until the last one came back. They share the same cached reads underneath,
   * so asking at once costs one round trip rather than five.
   */
  const [cookieStore, realPerms, previewing, perms, roleLabel, collectionsVisibility] =
    await Promise.all([
      cookies(),
      myRealPermissions(),
      // Previewing a person changes who the app answers as; the identity block
      // and the banner have to say so or it looks like the app is misbehaving.
      previewedMember(),
      myPermissions(),
      myRoleLabel(),
      // The same test the page itself applies, so the link never leads to a
      // redirect.
      getCollectionsVisibility(),
    ]);

  const previewRole = realPerms.has("org.manage")
    ? (cookieStore.get("preview_role")?.value ?? null)
    : null;
  const navGroups = getNavGroups(
    perms as Set<string>,
    collectionsVisibility.can_see_all || collectionsVisibility.attached
  );
  const homeHref = perms.has("timelines.view") ? "/timelines/quick-response" : "/learner";

  return (
    <div className="flex h-screen bg-background">
      <PageTiming />
      <AppSidebar
        groups={navGroups}
        brand={
          <Link href={homeHref} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Image
              src="https://facturmfg.com/wp-content/uploads/2022/11/Factur-Logo-300x94.png"
              alt="Factur logo"
              width={100}
              height={31}
              className="object-contain"
            />
          </Link>
        }
        profile={
          <div className="px-3 py-2">
            <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium">
                {profile?.full_name?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {previewing?.full_name ?? previewing?.email ?? profile?.full_name ?? "User"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {previewing
                    ? "Previewing"
                    : previewRole
                      ? `Previewing: ${getRoleLabel(previewRole)}`
                      : (roleLabel ?? "No role set")}
                </p>
              </div>
            </div>
          </div>
        }
        footer={
          <>
            <div className="p-3 pb-0">
              <Separator className="mb-3" />
              <GaibWidget />
              <form action={signOut}>
                <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground" size="sm" type="submit">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </Button>
              </form>
            </div>
          </>
        }
      />

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-auto">
        {/* Presence is the real signed-in person, not the previewed one -- the
            point of it is who is actually at a keyboard. */}
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-end border-b bg-card px-4">
          <OnlineUsers
            me={{
              id: user.id,
              name: profile.full_name ?? user.email ?? "User",
              avatarUrl: profile.avatar_url ?? null,
            }}
          />
        </header>
        <MaintenanceAlert canSee={perms.has("org.manage")} />
        {(previewing || previewRole) && (
          <PreviewBanner
            as={previewing ? (previewing.full_name ?? previewing.email) : getRoleLabel(previewRole!)}
            kind={previewing ? "person" : "role"}
          />
        )}
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
