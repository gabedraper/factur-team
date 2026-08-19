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
} from "lucide-react";
import { getRoleLabel } from "@/lib/roles";
import { RolePreviewSelector } from "@/components/role-preview-selector";
import { BugReportWidget } from "@/components/bug-report-widget";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

function getNavItems(role: string): NavItem[] {
  if (role === "admin") {
    return [
      { href: "/admin", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
      { href: "/admin/users", label: "Users", icon: <Users className="h-4 w-4" /> },
      { href: "/admin/enrollments", label: "Enrollments", icon: <ClipboardList className="h-4 w-4" /> },
      { href: "/admin/role-training", label: "Role Training", icon: <Map className="h-4 w-4" /> },
      { href: "/admin/courses", label: "All Courses", icon: <BookOpen className="h-4 w-4" /> },
      { href: "/admin/progress", label: "Team Progress", icon: <BarChart2 className="h-4 w-4" /> },
      { href: "/leaderboard", label: "Leaderboard", icon: <Trophy className="h-4 w-4" /> },
      { href: "/scoreboard", label: "Sales Scoreboard", icon: <Target className="h-4 w-4" /> },
      { href: "/admin/weights", label: "Scoring Weights", icon: <SlidersHorizontal className="h-4 w-4" /> },
    ];
  }
  return [
    { href: "/learner", label: "My Training", icon: <GraduationCap className="h-4 w-4" /> },
    { href: "/learner/certificates", label: "Certificates", icon: <Award className="h-4 w-4" /> },
    { href: "/leaderboard", label: "Leaderboard", icon: <Trophy className="h-4 w-4" /> },
    { href: "/scoreboard", label: "Sales Scoreboard", icon: <Target className="h-4 w-4" /> },
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
  const navItems = getNavItems(actualRole === "admin" && !previewRole ? "admin" : role);
  const homeHref = actualRole === "admin" && !previewRole ? "/admin" : "/learner";
  const lmsName = process.env.NEXT_PUBLIC_LMS_NAME || "Team Learning Academy";

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-6 pb-4">
          <Link href={homeHref} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Image
              src="https://facturmfg.com/wp-content/uploads/2022/11/Factur-Logo-300x94.png"
              alt="Factur logo"
              width={100}
              height={31}
              className="object-contain"
            />
            <span className="font-semibold text-sm leading-tight">Learning Academy</span>
          </Link>
        </div>

        <Separator />

        <div className="px-3 py-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted">
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

        <nav className="flex-1 px-3 py-2 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Role preview selector — admin only */}
        {actualRole === "admin" && (
          <>
            <Separator className="mx-3" />
            <RolePreviewSelector currentPreviewRole={previewRole} />
          </>
        )}

        <div className="p-3">
          <Separator className="mb-3" />
          <BugReportWidget />
          <form action={signOut}>
            <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground" size="sm" type="submit">
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
