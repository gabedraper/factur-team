import { LeaderboardTabs } from "@/components/scoreboard/LeaderboardTabs";

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <LeaderboardTabs />
      {children}
    </div>
  );
}
