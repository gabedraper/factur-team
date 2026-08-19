import type { ScoreboardPageProps } from "@/lib/scoreboard/page-props";
import { redirect } from "next/navigation";

export default async function LeaderboardIndexPage(
  props: ScoreboardPageProps
) {
  const sp = await props.searchParams;
  const params = new URLSearchParams(
    sp.period ? { period: String(sp.period) } : undefined
  );
  const qs = params.toString();
  redirect(`/scoreboard/hustle-points${qs ? `?${qs}` : ""}`);
}
