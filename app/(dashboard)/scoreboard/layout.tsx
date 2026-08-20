export default function ScoreboardLayout({ children }: { children: React.ReactNode }) {
  // The three boards are listed in the sidebar's Scoreboard group, so the
  // prototype's in-page tab strip would duplicate that navigation.
  return <div>{children}</div>;
}
