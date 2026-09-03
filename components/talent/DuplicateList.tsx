"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mergePeople } from "@/actions/talent";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Panel } from "@/components/talent/bits";
import { onDay } from "@/lib/talent/format";

type Pair = {
  a_id: string; a_name: string; a_email: string | null; a_created: string;
  b_id: string; b_name: string; b_email: string | null; b_created: string;
  basis: string; confidence: string;
};

/**
 * Suggested merges, never automatic ones.
 *
 * Which record survives is a choice, so both are offered as the one to keep --
 * the older is usually right, but the newer one is the one somebody has just
 * been working, and picking for them would lose that work.
 */
export function DuplicateList({ pairs, canEdit }: { pairs: Pair[]; canEdit: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const live = pairs.filter((p) => !done.includes(`${p.a_id}:${p.b_id}`));
  if (!live.length) return <Panel><Empty>Nothing looks duplicated</Empty></Panel>;

  function merge(keep: string, drop: string, key: string) {
    setError(null);
    start(async () => {
      const result = await mergePeople(keep, drop);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone((d) => [...d, key]);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {live.map((p) => {
        const key = `${p.a_id}:${p.b_id}`;
        return (
          <Panel key={key}>
            <div className="space-y-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <Chip colour={p.confidence === "high" ? "rose" : "amber"}>{p.basis}</Chip>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { id: p.a_id, name: p.a_name, email: p.a_email, created: p.a_created, other: p.b_id },
                  { id: p.b_id, name: p.b_name, email: p.b_email, created: p.b_created, other: p.a_id },
                ].map((side) => (
                  <div key={side.id} className="rounded-md border p-3">
                    <Link href={`/talent/people/${side.id}`} className="font-medium hover:underline">
                      {side.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">{side.email ?? "no email"}</p>
                    <p className="text-xs text-muted-foreground">Added {onDay(side.created)}</p>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => merge(side.id, side.other, key)}
                      >
                        Keep this one
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <Button size="sm" variant="ghost" onClick={() => setDone((d) => [...d, key])}>
                Not a duplicate
              </Button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
