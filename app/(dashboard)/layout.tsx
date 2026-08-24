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
} from "lucide-react";
import { getRoleLabel } from "@/lib/roles";
import { BugReportWidget } from "@/components/bug-report-widget";
import { AppSidebar, type NavGroup, type NavItem } from "@/components/app-sidebar";
import { PreviewBanner } from "@/components/preview-banner";
import { MaintenanceAlert } from "@/components/maintenance-alert";
import { previewedMember, myPermissions } from "@/lib/org";

function getNavGroups(perms: Set<string>): NavGroup[] {
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

  const actualRole = profile?.role || "learner";

  // Read preview role cookie (only honored if user is admin)
  const cookieStore = await cookies();
  const previewRole = actualRole === "admin" ? (cookieStore.get("preview_role")?.value ?? null) : null;

  const role = previewRole ?? actualRole;

  // Previewing a person changes who the app answers as; the identity block and
  // the banner have to say so or it looks like the app is just misbehaving.
  const previewing = await previewedMember();
  const perms = await myPermissions();
  const navGroups = getNavGroups(perms as Set<string>);
  const homeHref = perms.has("timelines.view") ? "/timelines/quick-response" : "/learner";

  return (
    <div className="flex h-screen bg-background">
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
                      : getRoleLabel(actualRole)}
                </p>
              </div>
            </div>
          </div>
        }
        footer={
          <>
            <div className="p-3 pb-0">
              <Separator className="mb-3" />
              <BugReportWidget />
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
