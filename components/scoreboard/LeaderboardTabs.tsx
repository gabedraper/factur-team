"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/scoreboard/hustle-points", label: "Hustle" },
  { href: "/scoreboard/deals", label: "Deals" },
  { href: "/scoreboard/retention", label: "Retention" },
] as const;

export function LeaderboardTabs() {
  const pathname = usePathname();

  return (
    <div className="flex justify-center gap-2 border-b border-neutral-900 px-6 py-4">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active
                ? "bg-white text-neutral-900"
                : "bg-neutral-900 text-neutral-400 hover:text-neutral-100"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
