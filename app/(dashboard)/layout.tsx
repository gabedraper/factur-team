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
import { AppSidebar, type NavGroup } from "@/components/app-sidebar";

function getNavGroups(role: string): NavGroup[] {
  const scoreboard: NavGroup = {
    label: "Scoreboard",
    items: [
      { href: "/scoreboard/hustle-points", label: "Hustle Points", icon: <Target className="h-4 w-4" /> },
      { href: "/scoreboard/deals", label: "Deals", icon: <Handshake className="h-4 w-4" /> },
      { href: "/scoreboard/retention", label: "Retention", icon: <Repeat className="h-4 w-4" /> },
    ],
  };

  // Its own section, with the three views as sub-links rather than an in-page
  // switcher -- same treatment as the sales boards.
  const timelines: NavGroup = {
    label: "Opportunity Timelines",
    items: [
      { href: "/timelines/quick-response", label: "Quick response", icon: <Zap className="h-4 w-4" /> },
      { href: "/timelines/follow-up", label: "Lead follow up", icon: <CalendarClock className="h-4 w-4" /> },
      { href: "/timelines/full-life", label: "Full lead life", icon: <Activity className="h-4 w-4" /> },
    ],
  };

  if (role === "admin") {
    scoreboard.items.push({
      href: "/admin/weights",
      label: "Scoring Weights",
      icon: <SlidersHorizontal className="h-4 w-4" />,
    });

    return [
      {
        label: "Learn",
        items: [
          { href: "/admin", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
          { href: "/admin/users", label: "Users", icon: <Users className="h-4 w-4" /> },
          { href: "/admin/enrollments", label: "Enrollments", icon: <ClipboardList className="h-4 w-4" /> },
          { href: "/admin/role-training", label: "Role Training", icon: <Map className="h-4 w-4" /> },
          { href: "/admin/courses", label: "All Courses", icon: <BookOpen className="h-4 w-4" /> },
          { href: "/admin/progress", label: "Team Progress", icon: <BarChart2 className="h-4 w-4" /> },
          { href: "/leaderboard", label: "Leaderboard", icon: <Trophy className="h-4 w-4" /> },
        ],
      },
      scoreboard,
      timelines,
    ];
  }

  return [
    {
      label: "Learn",
      items: [
        { href: "/learner", label: "My Training", icon: <GraduationCap className="h-4 w-4" /> },
        { href: "/learner/certificates", label: "Certificates", icon: <Award className="h-4 w-4" /> },
        { href: "/leaderboard", label: "Leaderboard", icon: <Trophy className="h-4 w-4" /> },
      ],
    },
    scoreboard,
    timelines,
  ];
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

  const actualRole = profile?.role || "learner";

  // Read preview role cookie (only honored if user is admin)
  const cookieStore = await cookies();
  const previewRole = actualRole === "admin" ? (cookieStore.get("preview_role")?.value ?? null) : null;

  const role = previewRole ?? actualRole;
  const navGroups = getNavGroups(actualRole === "admin" && !previewRole ? "admin" : role);
  const homeHref = actualRole === "admin" && !previewRole ? "/admin" : "/learner";

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
                <p className="text-sm font-medium truncate">{profile?.full_name || "User"}</p>
                <p className="text-xs text-muted-foreground">
                  {previewRole ? `Previewing: ${getRoleLabel(previewRole)}` : getRoleLabel(actualRole)}
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
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
