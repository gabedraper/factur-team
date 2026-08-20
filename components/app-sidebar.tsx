"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";

const STORAGE_KEY = "factur-nav-collapsed";
const GROUPS_KEY = "factur-nav-groups";

export type NavItem = { href: string; label: string; icon: React.ReactNode };
export type NavGroup = { label: string; items: NavItem[] };

export function AppSidebar({
  groups,
  brand,
  profile,
  footer,
}: {
  groups: NavGroup[];
  brand: React.ReactNode;
  profile: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [shutGroups, setShutGroups] = useState<string[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");

    // Sections start folded, so signing in gives a short menu of section names
    // rather than every link at once. The moment someone folds or unfolds
    // anything their own choice is stored and takes over from this.
    const stored = localStorage.getItem(GROUPS_KEY);
    if (stored === null) {
      setShutGroups(groups.map((g) => g.label));
      return;
    }
    try {
      const saved = JSON.parse(stored);
      if (Array.isArray(saved)) setShutGroups(saved);
    } catch {
      // Corrupt value from an older build -- fall back to everything open.
    }
  }, [groups]);

  function toggleGroup(label: string) {
    setShutGroups((shut) => {
      const next = shut.includes(label)
        ? shut.filter((l) => l !== label)
        : [...shut, label];
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  // Longest matching href wins, so /admin/weights highlights Scoring Weights
  // rather than the Dashboard entry at /admin.
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside
      className={`${collapsed ? "w-16" : "w-64"} border-r bg-card flex flex-col transition-[width] duration-200`}
    >
      <div className={`flex items-center gap-2 ${collapsed ? "justify-center p-3" : "p-6 pb-4"}`}>
        {!collapsed && brand}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          className={collapsed ? "px-2" : "ml-auto px-2"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      <Separator />

      {!collapsed && profile}

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group, i) => {
          // Group collapsing only applies to the expanded sidebar; in icon mode
          // there are no headers to click, so everything stays reachable.
          const shut = !collapsed && shutGroups.includes(group.label);
          const holdsActive = group.items.some((item) => item.href === activeHref);

          return (
            <div key={group.label} className={i > 0 ? "mt-4" : undefined}>
              {collapsed ? (
                i > 0 && <Separator className="my-2" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={!shut}
                  className={`flex w-full items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors hover:text-foreground ${
                    shut && holdsActive ? "text-foreground" : "text-muted-foreground/70"
                  }`}
                >
                  {shut ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                  {group.label}
                  {shut && holdsActive && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  )}
                </button>
              )}

              {!shut && (
                <div className="space-y-1 pt-1">
                  {group.items.map((item) => {
                    const active = item.href === activeHref;
                    return (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                          collapsed ? "justify-center px-0" : ""
                        } ${
                          active
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        <span className="shrink-0">{item.icon}</span>
                        {!collapsed && item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {!collapsed && footer}

      <div className="p-3">
        <Separator className="mb-3" />
        <ThemeToggle collapsed={collapsed} />
      </div>
    </aside>
  );
}
