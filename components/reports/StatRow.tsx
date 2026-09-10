import { Surface } from "@/components/ui/surface";
import type { Stat } from "@/lib/reports/types";

/** The figures above a report, over whatever the filters left in. */
export function StatRow({ stats }: { stats: Stat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <Surface key={s.label} pad="tight">
          <div className="text-meta text-muted-foreground">{s.label}</div>
          <div className="text-page-title tabular-nums">{s.value}</div>
        </Surface>
      ))}
    </div>
  );
}
